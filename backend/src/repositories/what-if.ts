/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * services/what-if.ts (виртуальный перенос смены).
 */
import { query } from '../db/index.js';

export async function listActiveStoresWithColor(orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name, code, COALESCE(color, '#2AABEE') as color
     FROM stores s WHERE COALESCE(is_active, true) = true AND COALESCE(org_id,'default') = $1 ORDER BY s.name`,
    [orgId]
  );
  return res.rows;
}

export async function findStaffIdsOnShift(storeId: string, date: string): Promise<number[]> {
  const res = await query(
    `SELECT employee_id FROM schedules
     WHERE store_id = $1 AND work_date::date = $2::date AND COALESCE(hours, 0) > 0`,
    [storeId, date]
  );
  return res.rows.map((r: any) => Number(r.employee_id));
}
