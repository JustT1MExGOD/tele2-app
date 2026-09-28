/**
 * Data Access Layer — SQL по таблицам sheet_schedule_mappings/
 * sheet_schedule_pending (0038_sheet_schedule_import.sql). См.
 * core/integrations/sheet-schedule-import.ts для бизнес-логики импорта.
 */
import { query } from '../db/index.js';

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
 * Чистые данные, без нормализации имени — сравнение normalizeName()
 * (core/integrations/sheet-name-match.ts) делает вызывающий код в core,
 * не репозиторий (infrastructure не должна зависеть от core, см.
 * docs/ARCHITECTURE.md). Сотрудников в сети немного, полная выборка по
 * org_id дешевле, чем городить функциональный индекс ради одной таблицы.
 */
export async function listMappingsForOrg(orgId: string | null): Promise<SheetMappingRow[]> {
  const res = await query(
    `SELECT id, org_id, sheet_name_raw, employee_id FROM sheet_schedule_mappings WHERE COALESCE(org_id,'') = COALESCE($1,'')`,
    [orgId]
  );
  return res.rows;
}

/** core/integrations/sheet-schedule-export.ts — обратный поиск (employee_id -> как записан в таблице), быстрый путь вместо живого fuzzy-поиска по листу на каждый пуш. Если у сотрудника несколько подтверждённых написаний (не должно, но не запрещено схемой) — берётся самое недавнее. */
export async function findMappingByEmployee(orgId: string | null, employeeId: number): Promise<SheetMappingRow | null> {
  const res = await query(
    `SELECT id, org_id, sheet_name_raw, employee_id FROM sheet_schedule_mappings
     WHERE COALESCE(org_id,'') = COALESCE($1,'') AND employee_id = $2
     ORDER BY confirmed_at DESC LIMIT 1`,
    [orgId, employeeId]
  );
  return res.rows[0] || null;
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
