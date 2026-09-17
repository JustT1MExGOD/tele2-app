/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `schedules`.
 * Начато в батче 1 с deleteFutureForEmployee (для employees.ts), остальной
 * SQL (апсерт графика, чтение месяца/дня) — батч 3.
 */
import { query } from '../db/index.js';
import { REPLACEMENT_PLACEHOLDER_STORE_ID } from '../../shared/replacement.js';

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

/** GET /schedules — своя запись видна всегда, даже вне своей сети (подмена).
 * LEFT JOIN на stores, не JOIN — store_id у schedules nullable (переходное
 * состояние без точки, см. findByMonthForOrgOrSelf ниже, тот же паттерн);
 * INNER JOIN здесь молча вырезал бы такие смены из дневного графика, хотя
 * findByMonthForOrgOrSelf их уже показывает — та же строка данных исчезала
 * или появлялась в зависимости от того, дневной или месячный вид открыт
 * (hotfix 20.57.1, finding #7). Org-фильтр для этого случая — COALESCE(st.org_id,
 * e.org_id, 'default'): та же authority, что уже использует DELETE /schedules
 * (assertEmployeeInOrg) для store_id IS NULL — своя сеть СОТРУДНИКА, а не
 * голый 'default'-sentinel (иначе storeless-смена была видна только сети,
 * буквально названной 'default' — реальный дефект, найденный прогоном
 * регрессионного теста на localhost Postgres, PASS 1 verification). */
export async function findByDayForOrgOrSelf(workDate: string, orgId: string, employeeId: number | null): Promise<any[]> {
  const res = await query(
    `SELECT sch.*, e.full_name, COALESCE(st.display_name, st.name) as store_name, st.short_name as store_short
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date::date = $1::date
       AND (COALESCE(st.org_id, e.org_id, 'default') = $2 OR sch.employee_id = $3)
     ORDER BY st.hours, e.full_name`,
    [workDate, orgId, employeeId]
  );
  return res.rows;
}

/** GET /schedules/month — тот же self-inclusion принцип, LEFT JOIN на
 * stores (смена может быть без точки на переходный период), тот же
 * COALESCE(st.org_id, e.org_id, 'default') fallback, что и в
 * findByDayForOrgOrSelf выше. */
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
       AND (COALESCE(st.org_id, e.org_id, 'default') = $3 OR sch.employee_id = $4)
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

/**
 * POST /shifts/open — a manager-scheduled "Замена" (store TBD) placeholder
 * row is bound to the real store once the employee actually opens a shift
 * for that date. `store_id = REPLACEMENT_PLACEHOLDER_STORE_ID` in the WHERE
 * clause is what makes this safe to call unconditionally on every open: it
 * only ever touches a row still holding the placeholder, never a real,
 * already-resolved schedule entry — a no-op UPDATE (0 rows) otherwise.
 */
export async function bindReplacementPlaceholder(employeeId: number, date: string, storeId: string): Promise<void> {
  await query(
    `UPDATE schedules SET store_id = $3
     WHERE employee_id = $1 AND work_date::date = $2::date AND store_id = $4`,
    [employeeId, date, storeId, REPLACEMENT_PLACEHOLDER_STORE_ID]
  );
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

/**
 * DELETE /schedules — раньше это была `findStoreIdFor`, возвращавшая
 * просто `store_id ?? null`: "смены вообще нет" и "смена есть, но
 * store_id IS NULL" (легитимное переходное состояние — см. комментарий у
 * findByMonthForOrgOrSelf, LEFT JOIN на stores) были неотличимы на
 * вызывающей стороне, из-за чего org-scope проверка молча пропускалась
 * целиком во втором случае — manager чужой сети мог удалить чужую
 * storeless-смену (hotfix 20.57.1, finding #6). `exists` разделяет эти
 * два случая явно.
 */
export async function findScheduleForDelete(employeeId: number, workDate: string): Promise<{ exists: boolean; storeId: string | null }> {
  const res = await query(`SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, workDate]);
  if (!res.rows.length) return { exists: false, storeId: null };
  return { exists: true, storeId: res.rows[0].store_id ?? null };
}

export async function deleteOne(employeeId: number, workDate: string): Promise<void> {
  await query(`DELETE FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, workDate]);
}

/**
 * core/schedule/schedule-generator.ts — уже зафиксированные (immutable)
 * строки графика целевого месяца: work_date < editableFromDate. Возвращает
 * сырые строки (employee_id, store_id, work_date, hours, role) — генератор
 * агрегирует их сам в fixedPastHours[e]/fixedPastShiftCount[e]/
 * fixedPastStoreShifts[e,s], разделяя стажёров и обычных сотрудников (role
 * из employees нужна именно для этого разделения, см. round 10 фикса).
 * org-фильтр — по сотруднику (employees.org_id), тот же принцип, что
 * countShiftsByEmployeeStoreInRange выше.
 */
export async function findLockedRowsForOrgMonth(
  orgId: string, start: string, end: string, editableFromDate: string
): Promise<{ employee_id: number; store_id: string; work_date: string; hours: number; shift_text: string; role: string }[]> {
  const res = await query(
    `SELECT sch.employee_id, sch.store_id, sch.work_date::text as work_date,
            COALESCE(sch.hours,0) as hours, sch.shift_text, e.role
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE COALESCE(e.org_id,'default') = $1
       AND sch.work_date >= $2::date AND sch.work_date < $3::date AND sch.work_date < $4::date
       AND sch.store_id IS NOT NULL`,
    [orgId, start, end, editableFromDate]
  );
  return res.rows;
}

/** Все строки целевого месяца (locked + editable) — только для fingerprint (изменение любой строки, включая locked, инвалидирует черновик). */
export async function findAllRowsForOrgMonth(
  orgId: string, start: string, end: string
): Promise<{ employee_id: number; store_id: string; work_date: string; hours: number; shift_text: string }[]> {
  const res = await query(
    `SELECT sch.employee_id, sch.store_id, sch.work_date::text as work_date, COALESCE(sch.hours,0) as hours, sch.shift_text
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE COALESCE(e.org_id,'default') = $1 AND sch.work_date >= $2::date AND sch.work_date < $3::date
       AND sch.store_id IS NOT NULL`,
    [orgId, start, end]
  );
  return res.rows;
}

/** APPLY — сколько editable-строк (work_date >= editableFromDate) будет заменено; для payload подтверждения замены. */
export async function countEditableForOrgMonth(orgId: string, editableFromDate: string, end: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int as cnt
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE COALESCE(e.org_id,'default') = $1 AND sch.work_date >= $2::date AND sch.work_date < $3::date`,
    [orgId, editableFromDate, end]
  );
  return Number(res.rows[0]?.cnt) || 0;
}

/** APPLY — удаляет ТОЛЬКО editable-диапазон (work_date >= editableFromDate); locked-строки никогда не трогает.
 * Вызывается внутри withTransaction — query() сама подхватывает активную транзакцию через AsyncLocalStorage
 * (см. data/db/index.ts), отдельный scoped-параметр не нужен, тот же принцип, что и в employee-plan-generator.ts. */
export async function deleteEditableRangeForOrgMonth(
  orgId: string, editableFromDate: string, end: string
): Promise<void> {
  await query(
    `DELETE FROM schedules
     WHERE work_date >= $2::date AND work_date < $3::date
       AND employee_id IN (SELECT id FROM employees WHERE COALESCE(org_id,'default') = $1)`,
    [orgId, editableFromDate, end]
  );
}

/** core/alerts/anomaly.ts (Explain, 21.0) — история укомплектованности по
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

/** core/alerts/anomaly.ts (Explain) — факт укомплектованности по графику на
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

/** core/plans/employee-plan-generator.ts — смены сотрудников на всю сеть
 * разом, сгруппированные по (employee_id, store_id), за один запрос
 * (избегаем N+1 по сотрудникам). Используется и для будущего месяца
 * (проекция смен), и для 3 исторических месяцев (знаменатель продуктивности
 * "на смену"). org-фильтр — по сотруднику (employees.org_id), не по точке:
 * подмена (сотрудник другой сети работает на этой точке) — легитимный,
 * уже поддерживаемый в проекте случай (см. findByDayForOrgOrSelf выше). */
export async function countShiftsByEmployeeStoreInRange(
  orgId: string, start: string, end: string
): Promise<{ employee_id: number; store_id: string; shifts: number }[]> {
  const res = await query(
    `SELECT sch.employee_id, sch.store_id, COUNT(*)::int as shifts
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE COALESCE(e.org_id,'default') = $1
       AND sch.work_date >= $2 AND sch.work_date < $3
       AND COALESCE(sch.hours,0) > 0 AND sch.store_id IS NOT NULL
     GROUP BY sch.employee_id, sch.store_id`,
    [orgId, start, end]
  );
  return res.rows;
}

// --- Admin Control Center, Phase 4+ — schedule row search/void(hard
// delete)/correct. Unlike sales/shifts, schedules has no soft-delete
// precedent and ~10 read call sites above that would all need a
// voided_at IS NULL filter for no real benefit (a wrongly-scheduled day
// is trivially re-enterable) — see core/admin/schedule-correction.ts's
// own header comment. So "void" here is a genuine, version-gated,
// audited hard delete; the full pre-delete row is snapshotted into
// audit_log.before by the caller as the sole recovery path.

export interface AdminScheduleSearchFilter {
  orgId: string;
  employeeId?: number;
  storeId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function adminSearchSchedules(f: AdminScheduleSearchFilter): Promise<any[]> {
  const conditions = [`COALESCE(e.org_id,'default') = $1`];
  const params: any[] = [f.orgId];
  if (f.employeeId) { params.push(f.employeeId); conditions.push(`sch.employee_id = $${params.length}`); }
  if (f.storeId) { params.push(f.storeId); conditions.push(`sch.store_id = $${params.length}`); }
  if (f.from) { params.push(f.from); conditions.push(`sch.work_date >= $${params.length}`); }
  if (f.to) { params.push(f.to); conditions.push(`sch.work_date <= $${params.length}`); }
  const limit = Math.min(f.limit || 50, 200);
  const offset = Math.max(f.offset || 0, 0);
  params.push(limit, offset);
  const res = await query(
    `SELECT sch.*, e.full_name as employee_name, COALESCE(st.display_name, st.name) as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sch.work_date DESC, sch.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return res.rows;
}

export async function findByIdForAdmin(scheduleId: number, lock = false, q: typeof query = query): Promise<any | null> {
  const res = await q(
    `SELECT sch.*, e.full_name as employee_name, e.org_id as employee_org_id,
            COALESCE(st.display_name, st.name) as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.id = $1 ${lock ? 'FOR UPDATE OF sch' : ''}`,
    [scheduleId]
  );
  return res.rows[0] || null;
}

/** Destination-collision check for correcting a row's work_date — mirrors
 * the ON CONFLICT (employee_id, work_date) constraint upsert() relies on;
 * excludeId lets the row being corrected check against itself harmlessly. */
export async function findScheduleForDateEmployee(employeeId: number, workDate: string, excludeId?: number): Promise<any | null> {
  const res = await query(
    `SELECT * FROM schedules WHERE employee_id = $1 AND work_date = $2 AND ($3::bigint IS NULL OR id != $3)`,
    [employeeId, workDate, excludeId ?? null]
  );
  return res.rows[0] || null;
}

export async function deleteByIdVersioned(scheduleId: number, expectedVersion: number, q: typeof query = query): Promise<any | null> {
  const res = await q(
    `DELETE FROM schedules WHERE id = $1 AND version = $2 RETURNING *`,
    [scheduleId, expectedVersion]
  );
  return res.rows[0] || null;
}

export async function correctScheduleRow(
  scheduleId: number, expectedVersion: number,
  fields: { storeId?: string; workDate?: string; hours?: number; shiftText?: string },
  q: typeof query = query
): Promise<any | null> {
  const sets: string[] = [];
  const params: any[] = [scheduleId, expectedVersion];
  if (fields.storeId !== undefined) { params.push(fields.storeId); sets.push(`store_id = $${params.length}`); }
  if (fields.workDate !== undefined) { params.push(fields.workDate); sets.push(`work_date = $${params.length}::date`); }
  if (fields.hours !== undefined) { params.push(fields.hours); sets.push(`hours = $${params.length}`); }
  if (fields.shiftText !== undefined) { params.push(fields.shiftText); sets.push(`shift_text = $${params.length}`); }
  if (!sets.length) return findByIdForAdmin(scheduleId, false, q);
  sets.push('version = version + 1');
  const res = await q(
    `UPDATE schedules SET ${sets.join(', ')} WHERE id = $1 AND version = $2 RETURNING *`,
    params
  );
  return res.rows[0] || null;
}
