/**
 * viewDraft/applyDraft — DRAFT lifecycle read + APPLY (idempotent, blocks
 * stale/blocking_errors, never touches locked rows). This is the highest-risk
 * code in the whole schedule-generator capability (transaction boundary,
 * atomicity of delete+insert) — moved verbatim from
 * core/schedule/schedule-generator.ts, only import paths changed.
 */
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as draftsRepo from '../../../data/repositories/schedule-drafts.js';
import { withTransaction } from '../../../data/db/index.js';
import { monthAdd } from '../domain/weekday.js';
import { StaleDraftError, DraftHasBlockingErrorsError } from './errors.js';
import { buildFingerprintFromLoaded } from './generate-draft.js';
import { loadInputs } from './generate-draft.js';

export async function viewDraft(draftId: number, orgId: string) {
  const draft = await draftsRepo.findDraftById(draftId, orgId);
  if (!draft) return null;
  const items = await draftsRepo.listDraftItems(draftId);
  return { draft, items };
}

/** APPLY — идемпотентно, блокирует stale/blocking_errors. Locked-строки (work_date <
 * editableFromDate) НИКОГДА не трогаются — ни при подсчёте существующих смен для
 * подтверждения замены, ни при delete/insert. См. план для полного обоснования. */
export async function applyDraft(draftId: number, orgId: string, appliedBy: number | null, replace?: boolean): Promise<any> {
  const draft = await draftsRepo.findDraftById(draftId, orgId);
  if (!draft) throw Object.assign(new Error('Черновик не найден'), { statusCode: 404 });

  if (draft.status === 'applied') return { draft, applied: false };
  if (draft.status === 'stale') throw new StaleDraftError();
  if ((draft.blocking_errors || []).length > 0) throw new DraftHasBlockingErrorsError(draft.blocking_errors);

  const month = String(draft.month).slice(0, 10);
  const loaded = await loadInputs(orgId, month);
  const currentFingerprint = buildFingerprintFromLoaded(orgId, loaded);
  if (currentFingerprint !== draft.input_fingerprint) {
    await draftsRepo.markStale(draft.id);
    throw new StaleDraftError();
  }

  const items = await draftsRepo.listDraftItems(draft.id);
  const editableFromDate = draft.editable_from_date;
  const monthEnd = monthAdd(month, 1);

  const existingEditableCount = await schedulesRepo.countEditableForOrgMonth(orgId, editableFromDate, monthEnd);
  if (existingEditableCount > 0 && !replace) {
    return { draft, applied: false, requires_replace_confirmation: true, existing_editable_shifts: existingEditableCount };
  }

  // Defensive re-check против ЭФФЕКТИВНОГО пост-apply состояния: locked
  // non-trainee строки (переживут apply как есть) + non-trainee draft items
  // (будут вставлены) — НЕ просто "есть ли другой draft item".
  const lockedRegularByStoreDate = new Map<string, number>();
  for (const r of loaded.lockedRows) {
    if (r.role !== 'trainee') {
      const key = `${r.store_id}|${r.work_date}`;
      lockedRegularByStoreDate.set(key, (lockedRegularByStoreDate.get(key) || 0) + 1);
    }
  }
  const empRoleById = new Map(loaded.employees.map((e) => [e.id, e.role]));
  const insertedRegularByStoreDate = new Map<string, number>();
  for (const it of items) {
    if (empRoleById.get(it.employee_id) !== 'trainee') {
      const key = `${it.store_id}|${it.work_date}`;
      insertedRegularByStoreDate.set(key, (insertedRegularByStoreDate.get(key) || 0) + 1);
    }
  }
  for (const it of items) {
    if (empRoleById.get(it.employee_id) !== 'trainee') continue;
    const key = `${it.store_id}|${it.work_date}`;
    const effective = (insertedRegularByStoreDate.get(key) || 0); // locked non-trainee rows never exist here (editable range wholesale replaced)
    if (effective < 1) {
      throw new DraftHasBlockingErrorsError([
        { message: `Стажёр ${it.employee_id} не может работать на точке ${it.store_id} ${it.work_date} без основного сотрудника.` }
      ]);
    }
  }
  void lockedRegularByStoreDate;

  return withTransaction(async () => {
    const locked = await draftsRepo.findDraftForUpdate(draftId, orgId);
    if (!locked) throw Object.assign(new Error('Черновик не найден'), { statusCode: 404 });
    if (locked.status === 'applied') return { draft: locked, applied: false };
    if (locked.status === 'stale') throw new StaleDraftError();

    // Повторная проверка locked-строк под транзакцией — если кто-то вручную
    // поправил уже зафиксированную сегодняшнюю смену прямо в этот момент.
    const recheckLocked = await schedulesRepo.findLockedRowsForOrgMonth(orgId, month, monthEnd, editableFromDate);
    const lockedSignature = recheckLocked.map((r) => `${r.employee_id}:${r.store_id}:${r.work_date}:${r.hours}:${r.shift_text}`).sort().join(',');
    const originalLockedSignature = loaded.lockedRows.map((r) => `${r.employee_id}:${r.store_id}:${r.work_date}:${r.hours}:${r.shift_text}`).sort().join(',');
    if (lockedSignature !== originalLockedSignature) throw new StaleDraftError();

    await schedulesRepo.deleteEditableRangeForOrgMonth(orgId, editableFromDate, monthEnd);
    for (const it of items) {
      await schedulesRepo.upsert(it.employee_id, it.store_id, it.work_date, it.shift_text, it.hours);
    }

    await draftsRepo.markApplied(locked.id, appliedBy, replace ? 'replace' : null);
    const applied = await draftsRepo.findDraftById(locked.id, orgId);
    return { draft: applied!, applied: true };
  });
}
