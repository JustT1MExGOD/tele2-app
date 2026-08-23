/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * services/supervisor-analytics.ts. Не «репозиторий одной таблицы» —
 * bespoke-агрегации специально под кабинет супервайзера/Command Center,
 * перенесены дословно (тот же приём, что live-map.ts/insights.ts).
 */
import { query } from '../db/index.js';
import type { StoreScope } from '../../core/analytics/supervisor.js';

export async function findStoreIdsForOrg(orgId: string): Promise<string[]> {
  const res = await query(`SELECT id FROM stores WHERE COALESCE(org_id, 'default') = $1`, [orgId]);
  return res.rows.map((r: any) => String(r.id));
}

export async function findAllStoresWithOrgName(): Promise<any[]> {
  const res = await query(
    `SELECT s.id, COALESCE(s.display_name, s.name) as name, s.display_name, s.code, COALESCE(s.color, '#2AABEE') as color,
            COALESCE(s.org_id, 'default') as org_id, COALESCE(o.name, 'default') as org_name
     FROM stores s LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
     WHERE COALESCE(s.is_active, true) = true ORDER BY s.name`
  );
  return res.rows;
}

export async function findStoresWithOrgNameForScope(storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT s.id, COALESCE(s.display_name, s.name) as name, s.display_name, s.code, COALESCE(s.color, '#2AABEE') as color,
            COALESCE(s.org_id, 'default') as org_id, COALESCE(o.name, 'default') as org_name
     FROM stores s LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
     WHERE s.id = ANY($1) AND COALESCE(s.is_active, true) = true ORDER BY s.name`,
    [storeIds]
  );
  return res.rows;
}

export async function findTodayFact(date: string, storeIds: string[], sumColsSql: string): Promise<any[]> {
  const res = await query(
    `SELECT store_id, ${sumColsSql}
     FROM sales WHERE sale_date::date = $1::date AND store_id = ANY($2)
     GROUP BY store_id`,
    [date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findPlansForDate(date: string, storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT * FROM store_plans WHERE plan_date::date = $1::date AND store_id = ANY($2)`,
    [date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findPlanTemplates(storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT * FROM store_plans WHERE plan_date IS NULL AND store_id = ANY($1)`,
    [storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findShiftsForDate(date: string, storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT sch.store_id, e.id as employee_id, e.full_name, sch.shift_text, sch.hours
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.work_date::date = $1::date AND COALESCE(sch.hours,0) > 0
       AND sch.store_id = ANY($2)
     ORDER BY sch.store_id, e.full_name`,
    [date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findSeriesForRange(from: string, date: string, storeIds: string[]): Promise<any[]> {
  const res = await query(
    // sale_date::text (не ::date) — раньше `d` возвращался JS Date-объектом
    // (node-postgres парсит date-колонку в полночь ПО ЛОКАЛЬНОМУ времени
    // процесса), а String(dateObj) даёт "Tue Aug 11", не "2026-08-11" —
    // seriesMap ключился нечитаемой строкой, которая никогда не совпадала
    // с ключом ниже (cursor.toISOString()), и trend был ВСЕГДА пустым.
    `SELECT sale_date::text as d,
       COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
       COALESCE(SUM(combo),0) combo
     FROM sales
     WHERE sale_date >= $1::date AND sale_date <= $2::date AND store_id = ANY($3)
     GROUP BY sale_date::date
     ORDER BY d`,
    [from, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findMonthFact(monthStart: string, date: string, storeIds: string[], sumColsSql: string): Promise<any[]> {
  const res = await query(
    `SELECT store_id, ${sumColsSql}
     FROM sales
     WHERE sale_date >= $1::date AND sale_date <= $2::date AND store_id = ANY($3)
     GROUP BY store_id`,
    [monthStart, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findMonthPlans(storeIds: string[], monthStart: string): Promise<any[]> {
  const res = await query(
    `SELECT * FROM store_month_plans WHERE store_id = ANY($1) AND month = $2::date`,
    [storeIds, monthStart]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findForecastHistory(storeIds: string[], date: string, histColsSql: string): Promise<any[]> {
  const res = await query(
    `SELECT store_id, sale_date::text as d, ${histColsSql}
     FROM sales
     WHERE store_id = ANY($1) AND sale_date >= ($2::date - interval '120 days') AND sale_date < $2::date
     GROUP BY store_id, sale_date
     ORDER BY store_id, sale_date`,
    [storeIds, date]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findTopEmployees(from: string, date: string, storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT e.id, e.full_name, COALESCE(e.org_id,'default') as org_id, COALESCE(o.name,'default') as org_name,
       COALESCE(SUM(s.sim),0) sim, COALESCE(SUM(s.mnp),0) mnp,
       COALESCE(SUM(s.pa),0) pa, COALESCE(SUM(s.combo),0) combo,
       COALESCE(SUM(s.phones),0) phones
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     LEFT JOIN organizations o ON o.id = COALESCE(e.org_id, 'default')
     WHERE s.sale_date >= $1::date AND s.sale_date <= $2::date
       AND s.store_id = ANY($3)
     GROUP BY e.id, e.full_name, e.org_id, o.name
     ORDER BY (COALESCE(SUM(s.sim),0)*2 + COALESCE(SUM(s.mnp),0)*3 + COALESCE(SUM(s.pa),0)*2) DESC
     LIMIT 15`,
    [from, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function findAiDipComments(date: string, dropStoreIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT DISTINCT ON (store_id) store_id, response
     FROM ai_audit
     WHERE kind = 'dip_comment' AND ref_date = $1::date AND store_id = ANY($2)
     ORDER BY store_id, created_at DESC`,
    [date, dropStoreIds]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

function storeFilterSql(scope: StoreScope, alias = 'st', paramIdx = 1) {
  if (scope === null) return { sql: '', params: [] as any[] };
  if (!scope.length) return { sql: ' AND false ', params: [] as any[] };
  return {
    sql: ` AND ${alias}.id = ANY($${paramIdx}) `,
    params: [scope]
  };
}

export async function findUnderperformingRaw(scope: StoreScope, date: string): Promise<any[]> {
  const filter = storeFilterSql(scope, 'st', 1);
  const res = await query(
    `SELECT sch.employee_id, e.full_name, sch.store_id, COALESCE(st.display_name, st.name) as store_name,
       COALESCE(SUM(s.sim + s.mnp + s.pa + s.combo), 0) as units
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     LEFT JOIN sales s ON s.employee_id = sch.employee_id AND s.store_id = sch.store_id
       AND s.sale_date::date = sch.work_date::date
     WHERE sch.work_date::date = $${scope !== null ? 2 : 1}::date
       AND COALESCE(sch.hours, 0) > 0
       ${filter.sql}
     GROUP BY sch.employee_id, e.full_name, sch.store_id, st.name, st.display_name`,
    scope !== null ? [...filter.params, date] : [date]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}
