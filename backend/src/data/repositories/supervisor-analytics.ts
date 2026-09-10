/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * services/supervisor-analytics.ts. Не «репозиторий одной таблицы» —
 * bespoke-агрегации специально под кабинет супервайзера/Command Center,
 * перенесены дословно (тот же приём, что live-map.ts/insights.ts).
 */
import { query } from '../db/index.js';
import type { StoreScope } from '../../core/shared/store-scope.js';

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

/**
 * "Топ за период" — кросс-сетевой (storeIds может охватывать несколько
 * сетей одного сектора, см. вызывающий код). Сумма продаж по-прежнему
 * считается по фактам продаж на точках (не меняется), но отображаемые
 * org_id/org_name теперь берутся от точки, а не от employee.org_id: для
 * сотрудника на замене (home_org A, реально продающего на точке сети B)
 * лидерборд должен показывать сеть B (чей результат засчитывается), а не
 * его домашнюю сеть — employee.org_id/home_org сам по себе нигде не
 * меняется. Когда у сотрудника в scope продажи на нескольких точках сразу
 * (несколько сетей за период), отображается сеть той точки, что дала
 * наибольший вклад — сумма метрик остаётся общей по всем точкам.
 */
export async function findTopEmployees(from: string, date: string, storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT e.id, e.full_name, s.store_id, COALESCE(st.org_id,'default') as org_id, COALESCE(o.name,'default') as org_name,
       COALESCE(SUM(s.sim),0) sim, COALESCE(SUM(s.mnp),0) mnp,
       COALESCE(SUM(s.pa),0) pa, COALESCE(SUM(s.combo),0) combo,
       COALESCE(SUM(s.phones),0) phones
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     JOIN stores st ON st.id = s.store_id
     LEFT JOIN organizations o ON o.id = COALESCE(st.org_id, 'default')
     WHERE s.sale_date >= $1::date AND s.sale_date <= $2::date
       AND s.store_id = ANY($3)
     GROUP BY e.id, e.full_name, s.store_id, st.org_id, o.name`,
    [from, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));

  const byEmployee = new Map<string, any>();
  for (const r of res.rows) {
    const key = String(r.id);
    const sim = Number(r.sim) || 0, mnp = Number(r.mnp) || 0, pa = Number(r.pa) || 0;
    const combo = Number(r.combo) || 0, phones = Number(r.phones) || 0;
    const storeScore = sim * 2 + mnp * 3 + pa * 2;
    let agg = byEmployee.get(key);
    if (!agg) {
      agg = { id: r.id, full_name: r.full_name, org_id: r.org_id, org_name: r.org_name, sim: 0, mnp: 0, pa: 0, combo: 0, phones: 0, _bestStoreScore: -1 };
      byEmployee.set(key, agg);
    }
    agg.sim += sim; agg.mnp += mnp; agg.pa += pa; agg.combo += combo; agg.phones += phones;
    if (storeScore > agg._bestStoreScore) {
      agg._bestStoreScore = storeScore;
      agg.org_id = r.org_id;
      agg.org_name = r.org_name;
    }
  }

  return [...byEmployee.values()]
    .map(({ _bestStoreScore, ...rest }) => rest)
    .sort((a, b) => (b.sim * 2 + b.mnp * 3 + b.pa * 2) - (a.sim * 2 + a.mnp * 3 + a.pa * 2))
    .slice(0, 15);
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

/**
 * "Просевшие сегодня" эвристика (см. findUnderperformingEmployees) — WHO is
 * evaluated (scheduled today, hours>0) is unchanged, but WHERE they're
 * evaluated now prefers their active (open) shift_session's store over the
 * scheduled one, falling back to the scheduled store only when no open
 * session exists for that exact date. Without this, a replacement employee
 * (scheduled Store A, actually working an open shift at Store B) was
 * checked for sales at Store A — a store they were never physically at —
 * and could be false-flagged as "underperforming" there even while
 * genuinely selling at Store B. The scope filter is applied to this
 * EFFECTIVE (actual) store, so an employee who's actually working outside
 * the viewed scope today simply drops out of that scope's dashboard,
 * rather than being misattributed to it.
 */
export async function findUnderperformingRaw(scope: StoreScope, date: string): Promise<any[]> {
  const filter = storeFilterSql(scope, 'st', 1);
  const res = await query(
    `WITH effective AS (
       SELECT sch.employee_id, sch.work_date,
              COALESCE(ss.store_id, sch.store_id) as store_id
       FROM schedules sch
       LEFT JOIN shift_sessions ss
         ON ss.employee_id = sch.employee_id
        AND ss.work_date = sch.work_date
        AND ss.status = 'open'
       WHERE sch.work_date::date = $${scope !== null ? 2 : 1}::date
         AND COALESCE(sch.hours, 0) > 0
     )
     SELECT ef.employee_id, e.full_name, ef.store_id, COALESCE(st.display_name, st.name) as store_name,
       COALESCE(SUM(s.sim + s.mnp + s.pa + s.combo), 0) as units
     FROM effective ef
     JOIN employees e ON e.id = ef.employee_id
     JOIN stores st ON st.id = ef.store_id
     LEFT JOIN sales s ON s.employee_id = ef.employee_id AND s.store_id = ef.store_id
       AND s.sale_date::date = ef.work_date::date
     WHERE true
       ${filter.sql}
     GROUP BY ef.employee_id, e.full_name, ef.store_id, st.name, st.display_name`,
    scope !== null ? [...filter.params, date] : [date]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}
