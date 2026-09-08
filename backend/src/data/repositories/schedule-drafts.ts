/**
 * DAL для schedule_drafts / schedule_draft_items (миграция 0030) — DRAFT ->
 * APPLY хранение для core/schedule/schedule-generator.ts. Никогда не пишет
 * в schedules напрямую (это делает вызывающий код через
 * schedulesRepo.upsert при APPLY, отдельным шагом), см.
 * employee-plan-drafts.ts для точно того же принципа.
 */
import { query } from '../db/index.js';

export type DraftStatus = 'draft' | 'applied' | 'stale';
export type SolverStatus = 'feasible' | 'timeout_feasible' | 'infeasible' | 'config_error' | 'solver_error';

export type ScheduleDraftRow = {
  id: number;
  org_id: string;
  month: string;
  status: DraftStatus;
  input_fingerprint: string;
  blocking_errors: any[];
  solver_status: SolverStatus;
  editable_from_date: string;
  score: number | null;
  generated_at: string;
  generated_by: number | null;
  applied_at: string | null;
  applied_by: number | null;
  replace_mode: string | null;
};

export type ScheduleDraftItemInput = {
  employee_id: number;
  work_date: string;
  store_id: string;
  shift_text: string;
  hours: number;
  predicted_score: number | null;
  explanation: Record<string, any>;
};

export type ScheduleDraftItemRow = ScheduleDraftItemInput & { id: number; draft_id: number };

export async function createDraft(
  orgId: string, month: string, fingerprint: string, blockingErrors: any[],
  solverStatus: SolverStatus, editableFromDate: string, generatedBy: number | null
): Promise<ScheduleDraftRow> {
  const res = await query(
    `INSERT INTO schedule_drafts (org_id, month, status, input_fingerprint, blocking_errors, solver_status, editable_from_date, generated_by)
     VALUES ($1, $2::date, 'draft', $3, $4::jsonb, $5, $6::date, $7)
     RETURNING *`,
    [orgId, month, fingerprint, JSON.stringify(blockingErrors), solverStatus, editableFromDate, generatedBy]
  );
  return res.rows[0];
}

export async function insertDraftItems(draftId: number, items: ScheduleDraftItemInput[]): Promise<void> {
  if (!items.length) return;
  const values: string[] = [];
  const params: any[] = [draftId];
  let i = 1;
  for (const it of items) {
    values.push(`($1, $${++i}, $${++i}::date, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}::jsonb)`);
    params.push(it.employee_id, it.work_date, it.store_id, it.shift_text, it.hours, it.predicted_score, JSON.stringify(it.explanation));
  }
  await query(
    `INSERT INTO schedule_draft_items (draft_id, employee_id, work_date, store_id, shift_text, hours, predicted_score, explanation)
     VALUES ${values.join(', ')}`,
    params
  );
}

/** APPLY — блокирует строку драфта на время транзакции (конкурентный повторный apply не гонится). */
export async function findDraftForUpdate(draftId: number, orgId: string): Promise<ScheduleDraftRow | null> {
  const res = await query(
    `SELECT * FROM schedule_drafts WHERE id = $1 AND org_id = $2 FOR UPDATE`,
    [draftId, orgId]
  );
  return res.rows[0] || null;
}

export async function findLatestDraft(orgId: string, month: string): Promise<ScheduleDraftRow | null> {
  const res = await query(
    `SELECT * FROM schedule_drafts WHERE org_id = $1 AND month = $2::date ORDER BY generated_at DESC LIMIT 1`,
    [orgId, month]
  );
  return res.rows[0] || null;
}

export async function findDraftById(draftId: number, orgId: string): Promise<ScheduleDraftRow | null> {
  const res = await query(`SELECT * FROM schedule_drafts WHERE id = $1 AND org_id = $2`, [draftId, orgId]);
  return res.rows[0] || null;
}

export async function listDraftItems(draftId: number): Promise<ScheduleDraftItemRow[]> {
  const res = await query(
    `SELECT * FROM schedule_draft_items WHERE draft_id = $1 ORDER BY work_date, employee_id`,
    [draftId]
  );
  return res.rows;
}

export async function markStale(draftId: number): Promise<void> {
  await query(`UPDATE schedule_drafts SET status = 'stale' WHERE id = $1 AND status = 'draft'`, [draftId]);
}

export async function markApplied(draftId: number, appliedBy: number | null, replaceMode: string | null): Promise<void> {
  await query(
    `UPDATE schedule_drafts SET status = 'applied', applied_at = now(), applied_by = $2, replace_mode = $3 WHERE id = $1`,
    [draftId, appliedBy, replaceMode]
  );
}
