/**
 * Admin Control Center, Phase 4+ — schedule row corrections: void (hard
 * delete), correct (store/date/hours).
 *
 * Unlike sales/shifts, "void" here is a genuine, version-gated, audited
 * hard delete, not a soft-void — schedules has no soft-delete precedent
 * and ~10 read call sites (findByDayForOrgOrSelf, findByMonthForOrgOrSelf,
 * findScheduledStoreId, countScheduledDays*, findLockedRowsForOrgMonth,
 * findAllRowsForOrgMonth, findHeadcountHistory/ForDate,
 * countShiftsByEmployeeStoreInRange, ...) would all need a
 * `voided_at IS NULL` filter for no real benefit — a wrongly-scheduled
 * day is trivially re-enterable. The full pre-delete row is snapshotted
 * into the audit_log `before` field as the sole recovery path — there is
 * no restore endpoint.
 */
import { withTransaction } from '../../data/db/index.js';
import {
  findByIdForAdmin, findScheduleForDateEmployee, deleteByIdVersioned, correctScheduleRow
} from '../schedules/index.js';
import * as auditRepo from '../../data/repositories/audit.js';

export class ScheduleVersionConflictError extends Error {
  constructor() {
    super('График был изменён другим администратором — обновите страницу и повторите');
    this.name = 'ScheduleVersionConflictError';
    Object.assign(this, { statusCode: 409 });
  }
}

export class ScheduleNotFoundError extends Error {
  constructor() {
    super('Смена в графике не найдена');
    this.name = 'ScheduleNotFoundError';
    Object.assign(this, { statusCode: 404 });
  }
}

export class ScheduleDestinationExistsError extends Error {
  constructor() {
    super('На выбранную дату у этого сотрудника уже есть смена в графике — перенос невозможен');
    this.name = 'ScheduleDestinationExistsError';
    Object.assign(this, { statusCode: 409 });
  }
}

interface Actor {
  employeeId: number;
  telegramId: number | null;
  role: string | null;
}

export async function previewVoidSchedule(scheduleId: number) {
  const row = await findByIdForAdmin(scheduleId);
  if (!row) throw new ScheduleNotFoundError();
  return { row };
}

export async function voidSchedule(opts: {
  scheduleId: number; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await findByIdForAdmin(opts.scheduleId, true, q);
    if (!row) throw new ScheduleNotFoundError();
    if (Number(row.version) !== opts.version) throw new ScheduleVersionConflictError();

    const deleted = await deleteByIdVersioned(opts.scheduleId, opts.version, q);
    if (!deleted) throw new ScheduleVersionConflictError();

    await auditRepo.record({
      orgId: row.employee_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SCHEDULE_VOIDED',
      targetType: 'schedule',
      targetId: String(opts.scheduleId),
      before: row,
      after: { deleted: true, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return deleted;
  });
}

export async function previewCorrectSchedule(scheduleId: number, newWorkDate?: string) {
  const row = await findByIdForAdmin(scheduleId);
  if (!row) throw new ScheduleNotFoundError();
  if (!newWorkDate || newWorkDate === row.work_date) return { row, destinationExists: false };
  const destination = await findScheduleForDateEmployee(row.employee_id, newWorkDate, scheduleId);
  return { row, destinationExists: !!destination };
}

export async function correctSchedule(opts: {
  scheduleId: number; version: number; storeId?: string; workDate?: string; hours?: number;
  reason: string; actor: Actor; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await findByIdForAdmin(opts.scheduleId, true, q);
    if (!row) throw new ScheduleNotFoundError();
    if (Number(row.version) !== opts.version) throw new ScheduleVersionConflictError();

    if (opts.workDate && opts.workDate !== row.work_date) {
      const destination = await findScheduleForDateEmployee(row.employee_id, opts.workDate, opts.scheduleId);
      if (destination) throw new ScheduleDestinationExistsError();
    }

    const updated = await correctScheduleRow(opts.scheduleId, opts.version, {
      storeId: opts.storeId, workDate: opts.workDate, hours: opts.hours
    }, q);
    if (!updated) throw new ScheduleVersionConflictError();

    await auditRepo.record({
      orgId: row.employee_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SCHEDULE_CORRECTED',
      targetType: 'schedule',
      targetId: String(opts.scheduleId),
      before: { store_id: row.store_id, work_date: row.work_date, hours: row.hours },
      after: {
        store_id: opts.storeId ?? row.store_id, work_date: opts.workDate ?? row.work_date,
        hours: opts.hours ?? row.hours, reason: opts.reason
      },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}
