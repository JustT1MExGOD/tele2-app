/**
 * The 4 employees present in the 2026-04..2026-07 source data with no
 * matching row in production `employees` (confirmed via a live read-only
 * query against all 16 existing rows). These are real historical people
 * (including "Славик МТС" — a real historical employee, display name kept
 * verbatim, NOT a placeholder/technical stand-in), created inactive so
 * they never appear as current staff and can never log in:
 * role='employee', is_active=false, access_status='none' (a real,
 * type-checked AccessStatus value — see src/auth/principal.ts),
 * telegram_id=NULL, org_id='default' (confirmed: every one of the 6
 * already-matched employees in this same dataset is org_id='default').
 *
 * Only `full_name` is NOT NULL without a column default on `employees`
 * (migrations/0001_baseline.sql) — every other touched column here has
 * an explicit value, nothing is left to an assumed/guessed default.
 */
export const HISTORICAL_EMPLOYEES_TO_CREATE: readonly string[] = [
  'Баранова София Андреевна',
  'Рогожин Вячеслав Александрович',
  'Славик МТС',
  'Чернова Александра Сергеевна',
];

export interface HistoricalEmployeeInsertResult {
  id: number;
  full_name: string;
  role: string;
  is_active: boolean;
  access_status: string;
  telegram_id: null;
  org_id: string;
}

/**
 * Inserts one historical employee row. Caller is responsible for running
 * this inside the same transaction as the batch's ledger entry (see
 * lib/ledger.ts) — the `q` param must be the transaction-scoped query
 * function, never the bare pool `query`.
 */
export async function insertHistoricalEmployee(
  fullName: string,
  orgId: string,
  q: (text: string, params?: any[]) => Promise<{ rows: any[] }>
): Promise<HistoricalEmployeeInsertResult> {
  const res = await q(
    `INSERT INTO employees (full_name, role, is_active, access_status, telegram_id, org_id)
     VALUES ($1, 'employee', false, 'none', NULL, $2)
     RETURNING id, full_name, role, is_active, access_status, telegram_id, org_id`,
    [fullName, orgId]
  );
  return res.rows[0];
}
