/**
 * DAL для employee_month_plan_drafts / employee_month_plan_draft_items
 * (миграция 0029) — DRAFT -> APPLY хранение для
 * core/plans/employee-plan-generator.ts. Никогда не пишет в
 * employee_month_plans напрямую (это делает вызывающий код через
 * plansRepo.upsertEmployeeMonthPlanRow при APPLY, отдельным шагом).
 */
import { query } from '../db/index.js';

export type DraftStatus = 'draft' | 'applied' | 'stale';

export type DraftRow = {
  id: number;
  org_id: string;
  month: string;
  status: DraftStatus;
  input_fingerprint: string;
  blocking_errors: any[];
  generated_at: string;
  generated_by: number | null;
  applied_at: string | null;
  applied_by: number | null;
};

export type DraftItemInput = {
  employee_id: number;
  total_shifts: number;
  by_store: any[];
  final_plan: Record<string, number>;
  warnings: any[];
};

export type DraftItemRow = DraftItemInput & { id: number; draft_id: number };

export async function createDraft(
  orgId: string, month: string, fingerprint: string, blockingErrors: any[], generatedBy: number | null
): Promise<DraftRow> {
  const res = await query(
    `INSERT INTO employee_month_plan_drafts (org_id, month, status, input_fingerprint, blocking_errors, generated_by)
     VALUES ($1, $2::date, 'draft', $3, $4::jsonb, $5)
     RETURNING *`,
    [orgId, month, fingerprint, JSON.stringify(blockingErrors), generatedBy]
  );
  return res.rows[0];
}

export async function insertDraftItems(draftId: number, items: DraftItemInput[]): Promise<void> {
  if (!items.length) return;
  const values: string[] = [];
  const params: any[] = [draftId];
  let i = 1;
  for (const it of items) {
    values.push(`($1, $${++i}, $${++i}, $${++i}::jsonb, $${++i}::jsonb, $${++i}::jsonb)`);
    params.push(it.employee_id, it.total_shifts, JSON.stringify(it.by_store), JSON.stringify(it.final_plan), JSON.stringify(it.warnings));
  }
  await query(
    `INSERT INTO employee_month_plan_draft_items (draft_id, employee_id, total_shifts, by_store, final_plan, warnings)
     VALUES ${values.join(', ')}`,
    params
  );
}

/** APPLY — блокирует строку драфта на время транзакции (конкурентный повторный apply не гонится). */
export async function findDraftForUpdate(draftId: number, orgId: string): Promise<DraftRow | null> {
  const res = await query(
    `SELECT * FROM employee_month_plan_drafts WHERE id = $1 AND org_id = $2 FOR UPDATE`,
    [draftId, orgId]
  );
  return res.rows[0] || null;
}

export async function findLatestDraft(orgId: string, month: string): Promise<DraftRow | null> {
  const res = await query(
    `SELECT * FROM employee_month_plan_drafts
     WHERE org_id = $1 AND month = $2::date
     ORDER BY generated_at DESC LIMIT 1`,
    [orgId, month]
  );
  return res.rows[0] || null;
}

export async function findDraftById(draftId: number, orgId: string): Promise<DraftRow | null> {
  const res = await query(
    `SELECT * FROM employee_month_plan_drafts WHERE id = $1 AND org_id = $2`,
    [draftId, orgId]
  );
  return res.rows[0] || null;
}

export async function listDraftItems(draftId: number): Promise<DraftItemRow[]> {
  const res = await query(
    `SELECT * FROM employee_month_plan_draft_items WHERE draft_id = $1 ORDER BY employee_id`,
    [draftId]
  );
  return res.rows;
}

export async function markStale(draftId: number): Promise<void> {
  await query(`UPDATE employee_month_plan_drafts SET status = 'stale' WHERE id = $1 AND status = 'draft'`, [draftId]);
}

export async function markApplied(draftId: number, appliedBy: number | null): Promise<void> {
  await query(
    `UPDATE employee_month_plan_drafts SET status = 'applied', applied_at = now(), applied_by = $2 WHERE id = $1`,
    [draftId, appliedBy]
  );
}
