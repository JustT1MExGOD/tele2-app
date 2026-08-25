/**
 * Data Access Layer (20.8.0, Full DAL) — read/write репозиторий для
 * services/insights.ts (профиль часов точки, сравнение с собой).
 */
import { query } from '../db/index.js';

export async function findHourProfile(storeId: string, dow: number): Promise<{ hour: number; weight: number }[]> {
  const res = await query(
    `SELECT hour, weight FROM store_hour_profile
     WHERE store_id = $1 AND dow = $2 ORDER BY hour`,
    [storeId, dow]
  );
  return res.rows;
}

export async function findDailySalesHistory(employeeId: number, today: string): Promise<any[]> {
  const res = await query(
    `SELECT sale_date::text as d,
            COALESCE(SUM(sim),0) as sim,
            COALESCE(SUM(mnp),0) as mnp,
            COALESCE(SUM(pa),0) as pa,
            COALESCE(SUM(combo),0) as combo,
            COALESCE(SUM(phones),0) as phones,
            COALESCE(SUM(accessories),0) as accessories
     FROM sales
     WHERE employee_id = $1
       AND sale_date >= ($2::date - interval '29 days')
       AND sale_date <= $2::date
     GROUP BY sale_date
     ORDER BY sale_date`,
    [employeeId, today]
  );
  return res.rows;
}
