/**
 * Data Access Layer (20.8.0, Full DAL) — sales_events (точный heatmap по часу).
 */
import { query } from '../db/index.js';

export async function insertEvent(
  employeeId: number, storeId: string, saleDate: string, hour: number, metric: string, delta: number, source: string
): Promise<void> {
  await query(
    `INSERT INTO sales_events (employee_id, store_id, sale_date, sale_hour, metric, delta, source)
     VALUES ($1,$2,$3::date,$4,$5,$6,$7)`,
    [employeeId, storeId, saleDate, hour, metric, delta, source]
  );
}

export async function findHourTotals(storeId: string, weeks: number): Promise<{ hour: number; metric: string; total: number }[]> {
  const res = await query(
    `SELECT sale_hour as hour,
            metric,
            SUM(delta)::float as total
     FROM sales_events
     WHERE store_id = $1
       AND sale_date >= CURRENT_DATE - ($2 * 7)
     GROUP BY sale_hour, metric
     ORDER BY sale_hour`,
    [storeId, weeks]
  );
  return res.rows;
}

export async function findDowHourMatrix(storeId: string, weeks: number): Promise<{ dow: number; hour: number; total: number }[]> {
  const res = await query(
    `SELECT EXTRACT(DOW FROM sale_date)::int as dow,
            sale_hour as hour,
            SUM(delta)::float as total
     FROM sales_events
     WHERE store_id = $1
       AND sale_date >= CURRENT_DATE - ($2 * 7)
     GROUP BY 1, 2`,
    [storeId, weeks]
  );
  return res.rows;
}

export async function deleteHourProfiles(storeId: string | null): Promise<void> {
  await query(
    `DELETE FROM store_hour_profile WHERE ($1::text IS NULL OR store_id = $1)`,
    [storeId]
  );
}

export async function rebuildHourProfilesFromEvents(storeId: string | null): Promise<void> {
  await query(
    `INSERT INTO store_hour_profile (store_id, dow, hour, weight)
     SELECT store_id,
            EXTRACT(DOW FROM sale_date)::int,
            sale_hour,
            SUM(delta)::numeric
     FROM sales_events
     WHERE ($1::text IS NULL OR store_id = $1)
     GROUP BY 1, 2, 3`,
    [storeId]
  );
}
