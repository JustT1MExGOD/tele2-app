/**
 * Data Access Layer — SQL по таблицам sheet_schedule_mappings/
 * sheet_schedule_pending (0038_sheet_schedule_import.sql). См.
 * core/integrations/sheet-schedule-import.ts для бизнес-логики импорта.
 */
import { query } from '../db/index.js';
import { normalizeName } from '../../core/integrations/sheet-name-match.js';

export interface SheetMappingRow {
  id: number;
  org_id: string | null;
  sheet_name_raw: string;
  employee_id: number;
}

export interface SheetPendingRow {
  id: number;
  org_id: string | null;
  store_id: string | null;
  sheet_name_raw: string;
  work_date: string;
  shift_raw: string | null;
  candidate_employee_id: number | null;
  candidate_score: number | null;
  status: 'pending' | 'confirmed' | 'rejected';
  created_at: string;
}

/**
 * Один нормализованный вариант написания имени может быть вписан в таблицу
 * с разным по регистру/пробелам текстом — ищем по normalizeName() в JS
 * (сотрудников в сети немного, полная выборка по org_id и сравнение здесь
 * дешевле, чем городить функциональный индекс ради одной таблицы).
 */
export async function findConfirmedMapping(orgId: string | null, sheetNameRaw: string): Promise<SheetMappingRow | null> {
  const res = await query(
    `SELECT id, org_id, sheet_name_raw, employee_id FROM sheet_schedule_mappings WHERE COALESCE(org_id,'') = COALESCE($1,'')`,
    [orgId]
  );
  const target = normalizeName(sheetNameRaw);
  return res.rows.find((r: SheetMappingRow) => normalizeName(r.sheet_name_raw) === target) || null;
}

export async function createConfirmedMapping(
  orgId: string | null, sheetNameRaw: string, employeeId: number, confirmedBy: number | null
): Promise<SheetMappingRow> {
  const res = await query(
    `INSERT INTO sheet_schedule_mappings (org_id, sheet_name_raw, employee_id, confirmed_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (COALESCE(org_id,''), sheet_name_raw) DO UPDATE SET employee_id = EXCLUDED.employee_id, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()
     RETURNING id, org_id, sheet_name_raw, employee_id`,
    [orgId, sheetNameRaw, employeeId, confirmedBy]
  );
  return res.rows[0];
}

export async function createPending(row: {
  orgId: string | null; storeId: string | null; sheetNameRaw: string; workDate: string; shiftRaw: string | null;
  candidateEmployeeId: number | null; candidateScore: number | null;
}): Promise<SheetPendingRow> {
  const res = await query(
    `INSERT INTO sheet_schedule_pending (org_id, store_id, sheet_name_raw, work_date, shift_raw, candidate_employee_id, candidate_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [row.orgId, row.storeId, row.sheetNameRaw, row.workDate, row.shiftRaw, row.candidateEmployeeId, row.candidateScore]
  );
  return res.rows[0];
}

export async function listPending(orgId: string): Promise<SheetPendingRow[]> {
  const res = await query(
    `SELECT p.*, e.full_name AS candidate_full_name, COALESCE(st.display_name, st.name) AS store_name
     FROM sheet_schedule_pending p
     LEFT JOIN employees e ON e.id = p.candidate_employee_id
     LEFT JOIN stores st ON st.id = p.store_id
     WHERE COALESCE(p.org_id,'default') = $1 AND p.status = 'pending'
     ORDER BY p.created_at DESC`,
    [orgId]
  );
  return res.rows;
}

export async function findPendingById(id: number): Promise<SheetPendingRow | null> {
  const res = await query(`SELECT * FROM sheet_schedule_pending WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function resolvePending(id: number, status: 'confirmed' | 'rejected', resolvedBy: number): Promise<void> {
  await query(
    `UPDATE sheet_schedule_pending SET status = $2, resolved_at = now(), resolved_by = $3 WHERE id = $1`,
    [id, status, resolvedBy]
  );
}
