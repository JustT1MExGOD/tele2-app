/**
 * Data Access Layer (20.8.0, Full DAL) — cron-специфичные таблицы
 * (cron_send_log, alert_flags) и bespoke-запросы cron/reports.ts,
 * cron/alerts.ts.
 */
import { query } from '../db/index.js';

/** cron/reports.ts::claimCronSend, services/network-digest.ts — атомарный claim по ключу. */
export async function claimSend(key: string): Promise<boolean> {
  const res = await query(
    `INSERT INTO cron_send_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
    [key]
  );
  return !!res.rows[0];
}

/** cron/reports.ts::loadStorePlans — день-план, при сбое ИЛИ отсутствии
 * пробуем шаблон отдельно (каждый шаг сам ловит ошибку — сохранённое
 * поведение: сбой именно дневного запроса не должен блокировать попытку
 * шаблонного). */
export async function findDayOrTemplatePlanResilient(storeId: string, date: string): Promise<any> {
  let res = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));
  if (!res.rows[0]) {
    res = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
      [storeId]
    ).catch(() => ({ rows: [] as any[] }));
  }
  return res.rows[0] || {};
}

export async function listStoresForReportSchedule(): Promise<{
  id: string; name: string; code: string;
  micro_report_times: string[] | null; skip_sunday_micro_times: string[] | null;
  close_time_weekday: string | null; close_time_sunday: string | null;
}[]> {
  const res = await query(
    `SELECT id, name, code, micro_report_times, skip_sunday_micro_times,
            close_time_weekday, close_time_sunday
     FROM stores ORDER BY name`
  );
  return res.rows;
}

/** cron/reports.ts — список имён смены точки на дату, БЕЗ сортировки (порядок как в БД — сохранённое поведение). */
export async function listStaffNamesUnordered(date: string, storeId: string): Promise<string[]> {
  const res = await query(
    `SELECT e.full_name FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
    [date, storeId]
  );
  return res.rows.map((r: any) => r.full_name);
}

export async function listTomorrowShiftsForReminders(today: string): Promise<any[]> {
  const res = await query(
    `SELECT sch.*, e.full_name, e.telegram_id, st.name as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date::date = ($1::date + interval '1 day')
       AND COALESCE(sch.hours,0) > 0
       AND e.telegram_id IS NOT NULL`,
    [today]
  );
  return res.rows;
}

/** cron/alerts.ts::wasSent/mark — alert_flags claim-once-per-key. */
export async function alertWasSent(key: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM alert_flags WHERE id = $1', [key]);
  return res.rows.length > 0;
}

export async function markAlertSent(key: string): Promise<void> {
  await query('INSERT INTO alert_flags (id) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
}

export async function findZeroSalesOnShift(date: string): Promise<any[]> {
  const res = await query(
    `SELECT e.full_name, e.telegram_id, st.name as store_name, sch.shift_text,
            COALESCE(st.org_id, 'default') as org_id
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date = $1 AND sch.hours > 0 AND e.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM sales s
         WHERE s.employee_id = e.id AND s.sale_date = $1
           AND (s.sim+s.mnp+s.pa+s.combo+s.phones) > 0
       )`,
    [date]
  );
  return res.rows;
}

export async function sumKeyMetricsForStoreDate(storeId: string, date: string): Promise<{ sim: number; mnp: number; pa: number; combo: number }> {
  const res = await query(
    `SELECT COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
            COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo
     FROM sales WHERE store_id = $1 AND sale_date = $2`,
    [storeId, date]
  );
  return res.rows[0];
}
