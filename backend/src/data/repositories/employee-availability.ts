/**
 * DAL для employee_schedule_preferences (миграция 0030). Этот проход
 * читает/пишет только kind IN ('unavailable','vacation') — остальные kind
 * схема-готовы (валидируются CHECK-ограничением в БД), но ещё не
 * записываются из UI, см. план.
 */
import { query } from '../db/index.js';

export type PreferenceRow = {
  id: number;
  org_id: string;
  employee_id: number;
  kind: string;
  specific_date: string | null;
  weekday: number | null;
  store_id: string | null;
  source: string;
  created_at: string;
  created_by: number | null;
};

export async function listUnavailableForEmployee(orgId: string, employeeId: number): Promise<PreferenceRow[]> {
  const res = await query(
    `SELECT * FROM employee_schedule_preferences
     WHERE org_id = $1 AND employee_id = $2 AND kind IN ('unavailable', 'vacation')
     ORDER BY specific_date`,
    [orgId, employeeId]
  );
  return res.rows;
}

/** Bulk — все unavailable/vacation строки сети за диапазон дат, без N+1 по сотрудникам. */
export async function listUnavailableForOrgRange(orgId: string, start: string, end: string): Promise<PreferenceRow[]> {
  const res = await query(
    `SELECT * FROM employee_schedule_preferences
     WHERE org_id = $1 AND kind IN ('unavailable', 'vacation') AND specific_date >= $2::date AND specific_date < $3::date`,
    [orgId, start, end]
  );
  return res.rows;
}

export async function addUnavailable(
  orgId: string, employeeId: number, kind: 'unavailable' | 'vacation', specificDate: string, createdBy: number | null
): Promise<PreferenceRow> {
  const res = await query(
    `INSERT INTO employee_schedule_preferences (org_id, employee_id, kind, specific_date, source, created_by)
     VALUES ($1, $2, $3, $4::date, 'manual', $5)
     RETURNING *`,
    [orgId, employeeId, kind, specificDate, createdBy]
  );
  return res.rows[0];
}

export async function deleteRow(orgId: string, employeeId: number, rowId: number): Promise<void> {
  await query(
    `DELETE FROM employee_schedule_preferences WHERE org_id = $1 AND employee_id = $2 AND id = $3`,
    [orgId, employeeId, rowId]
  );
}
