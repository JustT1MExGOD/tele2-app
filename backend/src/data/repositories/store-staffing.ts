/**
 * DAL для store_staffing_requirements (миграция 0030) — требуемое покрытие
 * (+ лимит стажёров) на точку, по дню недели или на конкретную дату
 * (override). См. core/schedule/schedule-generator.ts для правила
 * резолвинга (override дня побеждает дефолт дня недели).
 */
import { query } from '../db/index.js';

export type StaffingRequirementRow = {
  id: number;
  org_id: string;
  store_id: string;
  weekday: number | null;
  specific_date: string | null;
  required_employees: number;
  max_trainees: number;
  created_at: string;
  updated_at: string;
};

export async function listForStore(orgId: string, storeId: string): Promise<StaffingRequirementRow[]> {
  const res = await query(
    `SELECT * FROM store_staffing_requirements WHERE org_id = $1 AND store_id = $2 ORDER BY weekday NULLS LAST, specific_date NULLS LAST`,
    [orgId, storeId]
  );
  return res.rows;
}

/** Все резолвящие строки (weekday-дефолты + date-оверрайды) по всей сети за диапазон дат — bulk, без N+1. */
export async function listForOrg(orgId: string): Promise<StaffingRequirementRow[]> {
  const res = await query(`SELECT * FROM store_staffing_requirements WHERE org_id = $1`, [orgId]);
  return res.rows;
}

export async function upsertWeekdayRow(
  orgId: string, storeId: string, weekday: number, requiredEmployees: number, maxTrainees: number
): Promise<StaffingRequirementRow> {
  const res = await query(
    `INSERT INTO store_staffing_requirements (org_id, store_id, weekday, required_employees, max_trainees)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (store_id, weekday) WHERE specific_date IS NULL
     DO UPDATE SET required_employees = EXCLUDED.required_employees, max_trainees = EXCLUDED.max_trainees, updated_at = now()
     RETURNING *`,
    [orgId, storeId, weekday, requiredEmployees, maxTrainees]
  );
  return res.rows[0];
}

export async function upsertDateRow(
  orgId: string, storeId: string, specificDate: string, requiredEmployees: number, maxTrainees: number
): Promise<StaffingRequirementRow> {
  const res = await query(
    `INSERT INTO store_staffing_requirements (org_id, store_id, specific_date, required_employees, max_trainees)
     VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (store_id, specific_date) WHERE weekday IS NULL
     DO UPDATE SET required_employees = EXCLUDED.required_employees, max_trainees = EXCLUDED.max_trainees, updated_at = now()
     RETURNING *`,
    [orgId, storeId, specificDate, requiredEmployees, maxTrainees]
  );
  return res.rows[0];
}

export async function deleteDateRow(orgId: string, storeId: string, specificDate: string): Promise<void> {
  await query(
    `DELETE FROM store_staffing_requirements WHERE org_id = $1 AND store_id = $2 AND specific_date = $3::date`,
    [orgId, storeId, specificDate]
  );
}
