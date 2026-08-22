/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * routes-stats.ts (/stats/daily, /dashboard, /employee/progress/:id).
 * sumSelectSql/allColsSql уже собраны вызывающим кодом (динамический
 * список метрик из каталога, см. services/metrics-catalog.ts).
 */
import { query } from '../db/index.js';

export async function findDailyStoreStats(date: string, orgId: string, sumSelectSql: string): Promise<any[]> {
  const res = await query(
    `SELECT
       st.id as store_id,
       COALESCE(st.display_name, st.name) as name,
       st.code,
       ${sumSelectSql}
     FROM stores st
     LEFT JOIN sales s ON s.store_id = st.id AND s.sale_date = $1
     WHERE COALESCE(st.org_id, 'default') = $2
     GROUP BY st.id, st.name, st.display_name, st.code, st.hours
     ORDER BY st.hours`,
    [date, orgId]
  );
  return res.rows;
}

export async function findWeeklyLeaderboard(today: string, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT e.id as employee_id, e.full_name,
            COALESCE(SUM(s.sim),0)::int as sim,
            COALESCE(SUM(s.mnp),0)::int as mnp,
            COALESCE(SUM(s.pa),0)::int as pa,
            COALESCE(SUM(s.combo),0)::int as combo,
            COALESCE(SUM(s.phones),0)::float as phones,
            COALESCE(SUM(s.accessories),0)::float as accessories,
            (COALESCE(SUM(s.sim),0) + COALESCE(SUM(s.mnp),0)*2 + COALESCE(SUM(s.pa),0)*3)::int as score
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     JOIN stores st ON st.id = s.store_id
     WHERE s.sale_date::date >= ($1::date - interval '6 days')
       AND s.sale_date::date <= $1::date
       AND COALESCE(st.org_id, 'default') = $2
     GROUP BY e.id, e.full_name
     ORDER BY score DESC, sim DESC
     LIMIT 10`,
    [today, orgId]
  );
  return res.rows;
}

export async function findShiftStoreId(employeeId: string, date: string): Promise<string | null> {
  const res = await query(
    `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2 LIMIT 1`,
    [employeeId, date]
  );
  return res.rows[0]?.store_id ?? null;
}

export async function findStoreTemplatePlan(storeId: string): Promise<any> {
  const res = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
    [storeId]
  );
  return res.rows[0] || {};
}

export async function sumEmployeeDayFact(employeeId: string, date: string, allColsSql: string): Promise<Record<string, number>> {
  const res = await query(
    `SELECT ${allColsSql}
     FROM sales WHERE employee_id = $1 AND sale_date = $2`,
    [employeeId, date]
  );
  return res.rows[0] || {};
}
