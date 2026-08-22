/**
 * Data Access Layer (20.8.0, Full DAL) — read-model репозиторий для
 * services/report-image.ts::loadFactPlanStaff. sumColsSql уже собран
 * вызывающим кодом (список активных метрик из каталога — динамический,
 * бизнес-логика, не физическая схема).
 */
import { query } from '../db/index.js';

export async function findStoreBasic(storeId: string): Promise<{ id: string; name: string; code: string } | null> {
  const res = await query(`SELECT id, name, code FROM stores WHERE id = $1`, [storeId]).catch(() => ({ rows: [] as any[] }));
  return res.rows[0] || null;
}

export async function sumDayFactColumns(storeId: string, date: string, sumColsSql: string): Promise<Record<string, number>> {
  const res = await query(
    `SELECT ${sumColsSql} FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
    [storeId, date]
  );
  return res.rows[0] || {};
}

export async function findDayOrTemplatePlan(storeId: string, date: string): Promise<any> {
  let res = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
    [storeId, date]
  );
  if (!res.rows[0]) {
    res = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
      [storeId]
    );
  }
  return res.rows[0] || {};
}

export async function listStaffNames(storeId: string, date: string): Promise<string[]> {
  const res = await query(
    `SELECT e.full_name FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.store_id = $1 AND sch.work_date::date = $2::date AND COALESCE(sch.hours,0)>0
     ORDER BY e.full_name`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows.map((r: any) => r.full_name as string);
}
