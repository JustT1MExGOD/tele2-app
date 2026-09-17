/**
 * Admin Control Center, Phase 4+ — shift session corrections: void,
 * restore, correct (store/date).
 *
 * Mirrors core/admin/sales-correction.ts's structure exactly (error
 * classes with .statusCode, withTransaction, version-gated
 * WHERE id=$1 AND version=$2, preview/mutate pairs, auditRepo.record()
 * inside the same transaction) — see that file's own header comment for
 * the rationale behind the pattern.
 *
 * Unlike sales, "void" here is a genuine soft-void (voided_at/voided_by/
 * void_reason on shift_sessions itself, no metric columns to zero) and is
 * only ever allowed on closed/auto_closed sessions — voiding an OPEN
 * session would hide a shift the employee is still actively working,
 * which is a live-data-integrity problem, not a correction.
 *
 * Correcting a REPLACEMENT session's store_id recomputes org_id to match
 * the new store (never left stale) — org_id here is a real per-row
 * column (0031_shift_replacement.sql), not derived from a store join at
 * read time the way sales.store_org_id is.
 */
import { withTransaction, query } from '../../data/db/index.js';
import * as shiftsRepo from '../../data/repositories/shifts.js';
import * as auditRepo from '../../data/repositories/audit.js';

export class ShiftVersionConflictError extends Error {
  constructor() {
    super('Смена была изменена другим администратором — обновите страницу и повторите');
    this.name = 'ShiftVersionConflictError';
    Object.assign(this, { statusCode: 409 });
  }
}

export class ShiftNotFoundError extends Error {
  constructor() {
    super('Смена не найдена');
    this.name = 'ShiftNotFoundError';
    Object.assign(this, { statusCode: 404 });
  }
}

export class ShiftAlreadyVoidedError extends Error {
  constructor() {
    super('Смена уже аннулирована');
    this.name = 'ShiftAlreadyVoidedError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class ShiftNotVoidedError extends Error {
  constructor() {
    super('Смена не аннулирована — восстанавливать нечего');
    this.name = 'ShiftNotVoidedError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class ShiftOpenCannotVoidError extends Error {
  constructor() {
    super('Смена ещё открыта — аннулировать можно только закрытую смену');
    this.name = 'ShiftOpenCannotVoidError';
    Object.assign(this, { statusCode: 400 });
  }
}

interface Actor {
  employeeId: number;
  telegramId: number | null;
  role: string | null;
}

const VOIDABLE_STATUSES = ['closed', 'auto_closed'];

export async function previewVoidShift(sessionId: number) {
  const row = await shiftsRepo.findByIdForAdmin(sessionId);
  if (!row) throw new ShiftNotFoundError();
  if (row.voided_at) throw new ShiftAlreadyVoidedError();
  if (!VOIDABLE_STATUSES.includes(row.status)) throw new ShiftOpenCannotVoidError();
  return { row };
}

export async function voidShift(opts: {
  sessionId: number; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await shiftsRepo.findByIdForAdmin(opts.sessionId, true, q);
    if (!row) throw new ShiftNotFoundError();
    if (row.voided_at) throw new ShiftAlreadyVoidedError();
    if (!VOIDABLE_STATUSES.includes(row.status)) throw new ShiftOpenCannotVoidError();
    if (Number(row.version) !== opts.version) throw new ShiftVersionConflictError();

    const updated = await shiftsRepo.voidShiftRow(opts.sessionId, opts.version, opts.actor.employeeId, opts.reason, q);
    if (!updated) throw new ShiftVersionConflictError();

    await auditRepo.record({
      orgId: row.org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SHIFT_VOIDED',
      targetType: 'shift_session',
      targetId: String(opts.sessionId),
      before: { status: row.status, store_id: row.store_id, work_date: row.work_date },
      after: { voided: true, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}

export async function restoreShift(opts: {
  sessionId: number; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await shiftsRepo.findByIdForAdmin(opts.sessionId, true, q);
    if (!row) throw new ShiftNotFoundError();
    if (!row.voided_at) throw new ShiftNotVoidedError();
    if (Number(row.version) !== opts.version) throw new ShiftVersionConflictError();

    const updated = await shiftsRepo.restoreShiftRow(opts.sessionId, opts.version, q);
    if (!updated) throw new ShiftVersionConflictError();

    await auditRepo.record({
      orgId: row.org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SHIFT_RESTORED',
      targetType: 'shift_session',
      targetId: String(opts.sessionId),
      before: { voided: true },
      after: { voided: false, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}

export async function previewCorrectShift(sessionId: number, newStoreId?: string) {
  const row = await shiftsRepo.findByIdForAdmin(sessionId);
  if (!row) throw new ShiftNotFoundError();
  if (!newStoreId) return { row, crossOrg: false, newStore: null };
  const newStore = (await query(`SELECT id, COALESCE(display_name, name) as name, org_id FROM stores WHERE id = $1`, [newStoreId])).rows[0];
  return { row, crossOrg: !!newStore && newStore.org_id !== row.org_id, newStore };
}

export async function correctShift(opts: {
  sessionId: number; version: number; newStoreId?: string; workDate?: string;
  reason: string; actor: Actor; stepUpVerified: boolean; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await shiftsRepo.findByIdForAdmin(opts.sessionId, true, q);
    if (!row) throw new ShiftNotFoundError();
    if (Number(row.version) !== opts.version) throw new ShiftVersionConflictError();

    let newOrgId: string | null | undefined;
    if (opts.newStoreId) {
      const newStore = (await q(`SELECT id, org_id FROM stores WHERE id = $1`, [opts.newStoreId])).rows[0];
      const crossOrg = !!newStore && newStore.org_id !== row.org_id;
      if (crossOrg && !opts.stepUpVerified) {
        throw Object.assign(new Error('Перенос смены в другую сеть требует повторного подтверждения MFA'), { statusCode: 403, code: 'step_up_required' });
      }
      newOrgId = newStore?.org_id ?? row.org_id;
    }

    const updated = await shiftsRepo.correctShiftRow(opts.sessionId, opts.version, {
      storeId: opts.newStoreId,
      workDate: opts.workDate,
      newOrgId
    }, q);
    if (!updated) throw new ShiftVersionConflictError();

    await auditRepo.record({
      orgId: row.org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SHIFT_CORRECTED',
      targetType: 'shift_session',
      targetId: String(opts.sessionId),
      before: { store_id: row.store_id, work_date: row.work_date },
      after: { store_id: opts.newStoreId ?? row.store_id, work_date: opts.workDate ?? row.work_date, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role,
      targetOrgId: newOrgId ?? row.org_id
    }, q);

    return updated;
  });
}
