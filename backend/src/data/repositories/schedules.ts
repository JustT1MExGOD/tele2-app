/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `schedules`.
 * Начато в батче 1 с deleteFutureForEmployee (для employees.ts), остальной
 * SQL (апсерт графика, чтение месяца/дня) — батч 3.
 */
import { query } from '../db/index.js';

/** Будущие смены — не история, а обещание, что человек выйдет на работу;
 * прошлые не трогаем (реальная история). Best-effort, вызывающий код сам
 * решает, глушить ли ошибку (см. routes-employees.ts). */
export async function deleteFutureForEmployee(employeeId: number): Promise<void> {
  await query(
    `DELETE FROM schedules WHERE employee_id = $1 AND work_date::date >= (now() AT TIME ZONE 'Europe/Moscow')::date`,
    [employeeId]
  );
}

/** GET /export/schedules.csv — фиксированный набор колонок под CSV-экспорт за месяц. */
export async function findForCsvExport(start: string, end: string, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT sch.work_date, e.full_name, COALESCE(st.display_name, st.name) as store_name, st.code,
            sch.shift_text, sch.hours
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date >= $1 AND sch.work_date < $2 AND COALESCE(st.org_id,'default') = $3
     ORDER BY sch.work_date, e.full_name`,
    [start, end, orgId]
  );
  return res.rows;
}

/** GET /employees/:id/profile — сколько дней периода сотрудник был в графике с часами>0. */
export async function countScheduledDaysForEmployee(employeeId: number, from: string, to: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(DISTINCT work_date)::int as cnt
     FROM schedules
     WHERE employee_id = $1 AND work_date::date >= $2::date AND work_date::date <= $3::date
       AND COALESCE(hours, 0) > 0`,
    [employeeId, from, to]
  );
  return Number(res.rows[0]?.cnt) || 0;
}

/** GET /stores/:id/profile — сколько дней периода на точке кто-то был в графике с часами>0. */
export async function countScheduledDaysForStore(storeId: string, from: string, to: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(DISTINCT work_date)::int as cnt
     FROM schedules
     WHERE store_id = $1 AND work_date::date >= $2::date AND work_date::date <= $3::date
       AND COALESCE(hours, 0) > 0`,
    [storeId, from, to]
  );
  return Number(res.rows[0]?.cnt) || 0;
}

/** GET /me/insight, /me/day-plan-split — на какой точке смена сотрудника в эту дату (только store_id). */
export async function findShiftStoreIdForDate(employeeId: number, date: string): Promise<string | null> {
  const res = await query(
    `SELECT store_id FROM schedules
     WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
    [employeeId, date]
  );
  return res.rows[0]?.store_id ?? null;
}

/** GET /me/day — смена сотрудника на дату, с названием/цветом/адресом точки. */
export async function findShiftWithStore(employeeId: number, date: string): Promise<any | null> {
  const res = await query(
    `SELECT sch.*, COALESCE(st.display_name, st.name) as store_name, st.color, st.code as store_code, st.address as store_address
     FROM schedules sch
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.employee_id = $1
       AND sch.work_date::date = $2::date
       AND COALESCE(sch.hours, 0) > 0
     LIMIT 1`,
    [employeeId, date]
  );
  return res.rows[0] || null;
}

/** GET /me/day — сколько смен осталось с `date` до конца месяца, содержащего `monthDate`. */
export async function countRemainingInMonth(employeeId: number, date: string, monthDate: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int as cnt FROM schedules
     WHERE employee_id = $1
       AND work_date::date >= $2::date
       AND work_date::date < ($3::date + interval '1 month')
       AND COALESCE(hours, 0) > 0`,
    [employeeId, date, monthDate]
  );
  return Number(res.rows[0]?.cnt) || 0;
}

/** services/plans.ts::getEmployeeShiftCount/getEmployeeRemainingShifts — count смен с часами>0 в диапазоне дат. */
export async function countWorkedInRange(employeeId: number, start: string, end: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int as cnt FROM schedules
     WHERE employee_id = $1 AND work_date >= $2 AND work_date < $3 AND hours > 0`,
    [employeeId, start, end]
  );
  return Number(res.rows[0]?.cnt) || 0;
}

/** GET /schedules — своя запись видна всегда, даже вне своей сети (подмена). */
export async function findByDayForOrgOrSelf(workDate: string, orgId: string, employeeId: number | null): Promise<any[]> {
  const res = await query(
    `SELECT sch.*, e.full_name, COALESCE(st.display_name, st.name) as store_name, st.short_name as store_short
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date::date = $1::date
       AND (COALESCE(st.org_id, 'default') = $2 OR sch.employee_id = $3)
     ORDER BY st.hours, e.full_name`,
    [workDate, orgId, employeeId]
  );
  return res.rows;
}

/** GET /schedules/month — тот же self-inclusion принцип, LEFT JOIN на
 * stores (смена может быть без точки на переходный период). */
export async function findByMonthForOrgOrSelf(
  start: string, end: string, orgId: string, employeeId: number | null
): Promise<any[]> {
  const res = await query(
    `SELECT sch.work_date, sch.shift_text, sch.hours, sch.store_id,
            e.id as employee_id, e.full_name, e.short_name,
            COALESCE(st.display_name, st.name) as store_name, st.short_name as store_short
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date >= $1 AND sch.work_date < $2
       AND (COALESCE(st.org_id, 'default') = $3 OR sch.employee_id = $4)
     ORDER BY e.full_name, sch.work_date`,
    [start, end, orgId, employeeId]
  );
  return res.rows;
}

/** POST /schedule/what-if/apply — сохранить shift_text/hours с текущей смены при переносе. */
export async function findShiftTextAndHours(employeeId: number, date: string): Promise<{ shift_text: string | null; hours: number | null } | null> {
  const res = await query(
    `SELECT shift_text, hours FROM schedules
     WHERE employee_id = $1 AND work_date::date = $2::date LIMIT 1`,
    [employeeId, date]
  );
  return res.rows[0] || null;
}

/** POST /schedules и /schedules/bulk — тот же upsert в обоих. */
export async function upsert(
  employeeId: number, storeId: string, workDate: string, shiftText: string | undefined, hours: number | undefined
): Promise<any> {
  const res = await query(
    `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, work_date)
     DO UPDATE SET
       store_id = EXCLUDED.store_id,
       shift_text = EXCLUDED.shift_text,
       hours = EXCLUDED.hours
     RETURNING *`,
    [employeeId, storeId, workDate, shiftText, hours]
  );
  return res.rows[0];
}

/** /shifts/open — точка из графика, только смены с реальными часами (hours>0). */
export async function findScheduledStoreId(employeeId: number, date: string): Promise<string | null> {
  const res = await query(
    `SELECT store_id FROM schedules
     WHERE employee_id = $1 AND work_date::date = $2::date AND COALESCE(hours,0)>0
     LIMIT 1`,
    [employeeId, date]
  );
  return res.rows[0]?.store_id ?? null;
}

/** /sales/quick — та же идея, но без фильтра по hours (просто "куда назначен сегодня"). */
export async function findAnyScheduledStoreId(employeeId: number, date: string): Promise<string | null> {
  const res = await query(
    `SELECT store_id FROM schedules WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
    [employeeId, date]
  );
  return res.rows[0]?.store_id ?? null;
}

export async function findStoreIdFor(employeeId: number, workDate: string): Promise<string | null> {
  const res = await query(`SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, workDate]);
  return res.rows[0]?.store_id ?? null;
}

export async function deleteOne(employeeId: number, workDate: string): Promise<void> {
  await query(`DELETE FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, workDate]);
}

/** core/analytics/anomaly.ts (Explain, 21.0) — история укомплектованности по
 * графику (hours>0), тот же батч-по-точкам паттерн, что sales.ts::findHistoricalTotals. */
export async function findHeadcountHistory(
  storeIds: string[], beforeDate: string
): Promise<{ store_id: string; d: string; headcount: number }[]> {
  const res = await query(
    `SELECT store_id, work_date::date::text as d, COUNT(DISTINCT employee_id)::int as headcount
     FROM schedules
     WHERE store_id = ANY($1) AND work_date::date >= ($2::date - interval '120 days') AND work_date::date < $2::date
       AND COALESCE(hours,0) > 0
     GROUP BY store_id, work_date::date`,
    [storeIds, beforeDate]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

/** core/analytics/anomaly.ts (Explain) — факт укомплектованности по графику на
 * конкретную дату, по всем точкам разом. */
export async function findHeadcountForDate(
  storeIds: string[], date: string
): Promise<{ store_id: string; headcount: number }[]> {
  const res = await query(
    `SELECT store_id, COUNT(DISTINCT employee_id)::int as headcount
     FROM schedules
     WHERE store_id = ANY($1) AND work_date::date = $2::date AND COALESCE(hours,0) > 0
     GROUP BY store_id`,
    [storeIds, date]
  );
  return res.rows;
}
