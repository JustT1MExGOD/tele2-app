/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * services/live-map.ts (живая карта сети). Bespoke-запросы под один
 * конкретный экран, перенесены дословно.
 */
import { query } from '../db/index.js';

export async function listActiveStoresForOrg(orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name, code, color, lat, lng, plan_share
     FROM stores s
     WHERE COALESCE(is_active, true) = true AND COALESCE(org_id,'default') = $1
     ORDER BY hours NULLS LAST, s.name`,
    [orgId]
  );
  return res.rows;
}

export async function findOpenSessions(storeId: string, date: string): Promise<any[]> {
  const res = await query(
    `SELECT ss.*, e.full_name, e.short_name
     FROM shift_sessions ss
     JOIN employees e ON e.id = ss.employee_id
     WHERE ss.store_id = $1 AND ss.work_date = $2::date AND ss.status = 'open'`,
    [storeId, date]
  );
  return res.rows;
}

export async function findScheduledStaff(storeId: string, date: string): Promise<any[]> {
  const res = await query(
    `SELECT sch.employee_id, sch.shift_text, sch.hours, e.full_name, e.short_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.store_id = $1 AND sch.work_date::date = $2::date AND COALESCE(sch.hours,0) > 0`,
    [storeId, date]
  );
  return res.rows;
}

export async function findTodaySales(storeId: string, date: string): Promise<any> {
  const res = await query(
    `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo,
            COALESCE(SUM(phones),0) phones, COALESCE(SUM(accessories),0) accessories
     FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
    [storeId, date]
  );
  return res.rows[0] || {};
}

export async function findTodayOrTemplatePlan(storeId: string, date: string): Promise<any> {
  const res = await query(
    `SELECT sim, mnp, pa, combo, phones, accessories
     FROM store_plans
     WHERE store_id = $1 AND (plan_date = $2::date OR plan_date IS NULL)
     ORDER BY plan_date NULLS LAST
     LIMIT 1`,
    [storeId, date]
  );
  return res.rows[0] || {};
}

export async function findTodayCash(storeId: string, date: string): Promise<any | null> {
  const res = await query(
    `SELECT cash_fact, cash_1c, (cash_fact - (cash_1c + 2000)) as delta
     FROM store_cash WHERE store_id = $1 AND cash_date = $2::date`,
    [storeId, date]
  );
  return res.rows[0] || null;
}
