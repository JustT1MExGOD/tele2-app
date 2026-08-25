/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * services/forecast.ts. Bespoke-запросы под прогноз/подсказки по штату/
 * heatmap/когорты новичков, перенесены дословно.
 */
import { query } from '../db/index.js';

export async function findSalesHistory(storeId: string, fromDate: string): Promise<any[]> {
  const res = await query(
    `SELECT sale_date::text as d,
            COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
     FROM sales
     WHERE store_id = $1
       AND sale_date >= ($2::date - interval '120 days')
       AND sale_date < $2::date
     GROUP BY sale_date
     ORDER BY sale_date`,
    [storeId, fromDate]
  );
  return res.rows;
}

export async function listActiveStoresForOrg(orgId: string): Promise<{ id: string; name: string }[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name FROM stores WHERE COALESCE(is_active,true)=true AND COALESCE(org_id,'default') = $1`,
    [orgId]
  );
  return res.rows;
}

export async function findHeadcountByStoreDate(start: string, days: number): Promise<any[]> {
  const res = await query(
    `SELECT store_id, work_date::text as d, COUNT(DISTINCT employee_id)::int as headcount
     FROM schedules
     WHERE work_date >= $1::date AND work_date < ($1::date + ($2 || ' days')::interval)
       AND COALESCE(hours, 0) > 0
     GROUP BY store_id, work_date`,
    [start, days]
  );
  return res.rows;
}

export async function listNewHiresForOrg(orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT id, full_name, hire_date, created_at
     FROM employees
     WHERE COALESCE(is_active,true)=true
       AND COALESCE(org_id,'default') = $1
       AND (hire_date IS NOT NULL OR created_at IS NOT NULL)
     ORDER BY COALESCE(hire_date, created_at::date)`,
    [orgId]
  );
  return res.rows;
}

export async function sumCohortSales(employeeId: number, start: string, weeks: number): Promise<{ sim: number; mnp: number }> {
  const res = await query(
    `SELECT COALESCE(SUM(s.sim),0) sim, COALESCE(SUM(s.mnp),0) mnp
     FROM sales s
     WHERE s.employee_id = $1
       AND s.sale_date >= $2::date
       AND s.sale_date < ($2::date + ($3 || ' weeks')::interval)`,
    [employeeId, start, weeks]
  );
  return res.rows[0] || { sim: 0, mnp: 0 };
}
