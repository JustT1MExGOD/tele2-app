/**
 * The real write path for the historical import (2026-04-01..2026-07-31).
 *
 * This module is the ONLY place in scripts/historical-import that issues
 * INSERT/UPDATE against production tables. It intentionally talks to
 * `sales`/`schedules`/`employee_month_plans`/`store_cash`/`employees`
 * with raw SQL only — it never calls any application service (no
 * applySaleUpsert, no shift/clock-in code, no XP/gamification, no report
 * jobs, no notifications). That is what guarantees zero side effects:
 * there is no code path here that could create a shift_sessions row, a
 * clock-in, an XP grant, or a notification — those all live in service
 * code this module never imports.
 *
 * Classification of every row (INSERT / UPDATE_IDENTICAL / UPDATE_DIFFERENT
 * / SOURCE_ONLY) comes from lib/diff.ts — the exact same pure functions
 * dry-run.ts uses read-only, so the dry-run report and what actually gets
 * written can never silently diverge.
 *
 * Every write happens inside one `withTransaction` call together with its
 * `import_ledger` entry, so a failure anywhere in the batch (a constraint
 * violation, a thrown error) rolls back the ENTIRE batch — nothing
 * partially applied ever survives a failed run.
 */
import { withTransaction } from '../../../src/data/db/index.js';
import { recordLedgerEntry } from './ledger.js';
import { insertHistoricalEmployee, HISTORICAL_EMPLOYEES_TO_CREATE } from './historical-employees.js';
import { METRIC_COLS, diffSales, diffSchedules, diffPlans, diffCash } from './diff.js';
import type { DailyFactRow } from './daily-facts.js';
import type { StoreResolution } from './resolve-store.js';
import type { SchedulePlanRow } from './schedules-import.js';
import type { MonthlyPlanRow } from './monthly-plans.js';
import type { CashPlanRow } from './cash.js';

export type ApplyQuery = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export interface ApplySources {
  dailyFacts: DailyFactRow[];
  resolutions: StoreResolution[]; // same length/order as dailyFacts
  schedulePlanRows: SchedulePlanRow[];
  monthlyPlans: MonthlyPlanRow[];
  cashPlan: CashPlanRow[];
}

export interface ApplyCounts {
  employeesCreated: number;
  salesInserted: number;
  salesUpdated: number;
  salesSkippedIdentical: number;
  scheduleInserted: number;
  scheduleUpdated: number;
  scheduleSkippedIdentical: number;
  plansInserted: number;
  plansUpdated: number;
  plansSkippedIdentical: number;
  cashInserted: number;
  cashUpdated: number;
  cashSkippedIdentical: number;
}

function emptyCounts(): ApplyCounts {
  return {
    employeesCreated: 0,
    salesInserted: 0, salesUpdated: 0, salesSkippedIdentical: 0,
    scheduleInserted: 0, scheduleUpdated: 0, scheduleSkippedIdentical: 0,
    plansInserted: 0, plansUpdated: 0, plansSkippedIdentical: 0,
    cashInserted: 0, cashUpdated: 0, cashSkippedIdentical: 0,
  };
}

async function resolveOrCreateEmployees(
  q: ApplyQuery,
  batchId: string,
  orgId: string
): Promise<{ empByName: Map<string, number>; created: number }> {
  const empRes = await q('SELECT id, full_name FROM employees');
  const empByName = new Map<string, number>(empRes.rows.map((r: any) => [r.full_name, Number(r.id)]));
  let created = 0;
  for (const name of HISTORICAL_EMPLOYEES_TO_CREATE) {
    if (empByName.has(name)) continue;
    const row = await insertHistoricalEmployee(name, orgId, q);
    empByName.set(name, row.id);
    created += 1;
    await recordLedgerEntry({
      batchId,
      entity: 'employees',
      operation: 'insert',
      naturalKey: { full_name: name, org_id: orgId },
      beforeState: null,
      afterState: {
        id: row.id,
        full_name: row.full_name,
        role: row.role,
        is_active: row.is_active,
        access_status: row.access_status,
        telegram_id: row.telegram_id,
        org_id: row.org_id,
      },
      sourceRow: { full_name: name, reason: 'HISTORICAL_EMPLOYEE_NOT_IN_PRODUCTION' },
    });
  }
  return { empByName, created };
}

async function applySales(q: ApplyQuery, batchId: string, sources: ApplySources, empByName: Map<string, number>, counts: ApplyCounts) {
  const existing = await q(
    `SELECT employee_id, store_id, sale_date, ${METRIC_COLS.join(', ')}
     FROM sales WHERE sale_date BETWEEN '2026-04-01' AND '2026-07-31'`
  );
  const diffs = diffSales(existing.rows, sources.dailyFacts, sources.resolutions, empByName);
  for (const d of diffs) {
    if (d.kind === 'SOURCE_ONLY') continue;
    if (d.kind === 'UPDATE_IDENTICAL') { counts.salesSkippedIdentical += 1; continue; }

    if (d.kind === 'INSERT') {
      const cols = ['employee_id', 'store_id', 'sale_date', ...METRIC_COLS];
      const vals: any[] = [d.employeeId, d.storeId, d.date, ...METRIC_COLS.map((c) => d.metrics[c])];
      const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(', ');
      await q(`INSERT INTO sales (${cols.join(', ')}) VALUES (${placeholders})`, vals);
      counts.salesInserted += 1;
      await recordLedgerEntry({
        batchId, entity: 'sales', operation: 'insert',
        naturalKey: { employee_id: d.employeeId, store_id: d.storeId, sale_date: d.date },
        beforeState: null,
        afterState: { employee_id: d.employeeId, store_id: d.storeId, sale_date: d.date, ...d.metrics },
        sourceRow: { employeeName: d.fact.employeeName, date: d.date, resolutionSource: d.resolution.resolutionSource, resolutionReason: d.resolution.resolutionReason },
      });
      continue;
    }

    // UPDATE_DIFFERENT
    const before: Record<string, unknown> = {};
    for (const c of METRIC_COLS) before[c] = d.before![c];
    const setClause = METRIC_COLS.map((c, idx) => `${c} = $${idx + 1}`).join(', ');
    await q(
      `UPDATE sales SET ${setClause}
       WHERE employee_id = $${METRIC_COLS.length + 1} AND store_id = $${METRIC_COLS.length + 2} AND sale_date = $${METRIC_COLS.length + 3}`,
      [...METRIC_COLS.map((c) => d.metrics[c]), d.employeeId, d.storeId, d.date]
    );
    counts.salesUpdated += 1;
    await recordLedgerEntry({
      batchId, entity: 'sales', operation: 'update',
      naturalKey: { employee_id: d.employeeId, store_id: d.storeId, sale_date: d.date },
      beforeState: before,
      afterState: d.metrics,
      sourceRow: { employeeName: d.fact.employeeName, date: d.date, resolutionSource: d.resolution.resolutionSource, resolutionReason: d.resolution.resolutionReason },
    });
  }
}

async function applySchedules(q: ApplyQuery, batchId: string, sources: ApplySources, empByName: Map<string, number>, counts: ApplyCounts) {
  const existing = await q(
    `SELECT employee_id, work_date, store_id, shift_text, hours
     FROM schedules WHERE work_date BETWEEN '2026-04-01' AND '2026-07-31'`
  );
  const diffs = diffSchedules(existing.rows, sources.schedulePlanRows, empByName);
  for (const d of diffs) {
    if (d.kind === 'SOURCE_ONLY') continue;
    if (d.kind === 'UPDATE_IDENTICAL') { counts.scheduleSkippedIdentical += 1; continue; }
    const after = { store_id: d.row.storeId, shift_text: d.row.shiftText, hours: d.row.hours };

    if (d.kind === 'INSERT') {
      await q(
        `INSERT INTO schedules (employee_id, work_date, store_id, shift_text, hours) VALUES ($1, $2, $3, $4, $5)`,
        [d.employeeId, d.row.date, after.store_id, after.shift_text, after.hours]
      );
      counts.scheduleInserted += 1;
      await recordLedgerEntry({
        batchId, entity: 'schedules', operation: 'insert',
        naturalKey: { employee_id: d.employeeId, work_date: d.row.date },
        beforeState: null,
        afterState: { employee_id: d.employeeId, work_date: d.row.date, ...after },
        sourceRow: { employeeName: d.row.employeeName, date: d.row.date, status: d.row.status },
      });
      continue;
    }

    const before = { store_id: d.before.store_id, shift_text: d.before.shift_text, hours: d.before.hours };
    await q(
      `UPDATE schedules SET store_id = $1, shift_text = $2, hours = $3 WHERE employee_id = $4 AND work_date = $5`,
      [after.store_id, after.shift_text, after.hours, d.employeeId, d.row.date]
    );
    counts.scheduleUpdated += 1;
    await recordLedgerEntry({
      batchId, entity: 'schedules', operation: 'update',
      naturalKey: { employee_id: d.employeeId, work_date: d.row.date },
      beforeState: before,
      afterState: after,
      sourceRow: { employeeName: d.row.employeeName, date: d.row.date, status: d.row.status },
    });
  }
}

async function applyPlans(q: ApplyQuery, batchId: string, sources: ApplySources, empByName: Map<string, number>, counts: ApplyCounts) {
  const existing = await q(
    `SELECT employee_id, month, ${METRIC_COLS.join(', ')}
     FROM employee_month_plans WHERE month BETWEEN '2026-04-01' AND '2026-07-31'`
  );
  const diffs = diffPlans(existing.rows, sources.monthlyPlans, empByName);
  for (const d of diffs) {
    if (d.kind === 'SOURCE_ONLY') continue;
    if (d.kind === 'UPDATE_IDENTICAL') { counts.plansSkippedIdentical += 1; continue; }

    if (d.kind === 'INSERT') {
      const cols = ['employee_id', 'month', ...METRIC_COLS];
      const vals: any[] = [d.employeeId, d.month, ...METRIC_COLS.map((c) => d.metrics[c])];
      const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(', ');
      await q(`INSERT INTO employee_month_plans (${cols.join(', ')}) VALUES (${placeholders})`, vals);
      counts.plansInserted += 1;
      await recordLedgerEntry({
        batchId, entity: 'employee_month_plans', operation: 'insert',
        naturalKey: { employee_id: d.employeeId, month: d.month },
        beforeState: null,
        afterState: { employee_id: d.employeeId, month: d.month, ...d.metrics },
        sourceRow: { employeeName: d.row.employeeName, month: d.row.month },
      });
      continue;
    }

    const before: Record<string, unknown> = {};
    for (const c of METRIC_COLS) before[c] = d.before[c];
    const setClause = METRIC_COLS.map((c, idx) => `${c} = $${idx + 1}`).join(', ');
    await q(
      `UPDATE employee_month_plans SET ${setClause} WHERE employee_id = $${METRIC_COLS.length + 1} AND month = $${METRIC_COLS.length + 2}`,
      [...METRIC_COLS.map((c) => d.metrics[c]), d.employeeId, d.month]
    );
    counts.plansUpdated += 1;
    await recordLedgerEntry({
      batchId, entity: 'employee_month_plans', operation: 'update',
      naturalKey: { employee_id: d.employeeId, month: d.month },
      beforeState: before,
      afterState: d.metrics,
      sourceRow: { employeeName: d.row.employeeName, month: d.row.month },
    });
  }
}

async function applyCash(q: ApplyQuery, batchId: string, sources: ApplySources, counts: ApplyCounts) {
  const existing = await q(
    `SELECT store_id, cash_date, cash_fact, cash_1c
     FROM store_cash WHERE cash_date BETWEEN '2026-04-01' AND '2026-07-31'`
  );
  const diffs = diffCash(existing.rows, sources.cashPlan);
  for (const d of diffs) {
    if (d.kind === 'SOURCE_ONLY') continue; // SKIP_WITH_WARNING rows never written
    if (d.kind === 'UPDATE_IDENTICAL') { counts.cashSkippedIdentical += 1; continue; }
    const after = { cash_fact: d.row.cashFact as number, cash_1c: d.row.cash1c as number };

    if (d.kind === 'INSERT') {
      await q(
        `INSERT INTO store_cash (store_id, cash_date, cash_fact, cash_1c) VALUES ($1, $2, $3, $4)`,
        [d.row.storeId, d.row.cashDate, after.cash_fact, after.cash_1c]
      );
      counts.cashInserted += 1;
      await recordLedgerEntry({
        batchId, entity: 'store_cash', operation: 'insert',
        naturalKey: { store_id: d.row.storeId, cash_date: d.row.cashDate },
        beforeState: null,
        afterState: { store_id: d.row.storeId, cash_date: d.row.cashDate, ...after },
        sourceRow: { storeId: d.row.storeId, cashDate: d.row.cashDate },
      });
      continue;
    }

    const before = { cash_fact: d.before.cash_fact, cash_1c: d.before.cash_1c };
    await q(
      `UPDATE store_cash SET cash_fact = $1, cash_1c = $2 WHERE store_id = $3 AND cash_date = $4`,
      [after.cash_fact, after.cash_1c, d.row.storeId, d.row.cashDate]
    );
    counts.cashUpdated += 1;
    await recordLedgerEntry({
      batchId, entity: 'store_cash', operation: 'update',
      naturalKey: { store_id: d.row.storeId, cash_date: d.row.cashDate },
      beforeState: before,
      afterState: after,
      sourceRow: { storeId: d.row.storeId, cashDate: d.row.cashDate },
    });
  }
}

/**
 * Applies the full historical import as one transaction. `orgId` is the
 * org new historical employees are created under — callers pass the
 * confirmed-live value ('default' in production, verified against the 6
 * already-matched employees in this same dataset), never a guessed
 * constant baked into this module.
 */
export async function applyHistoricalImportBatch(
  sources: ApplySources,
  batchId: string,
  orgId: string
): Promise<ApplyCounts> {
  return withTransaction(async (q) => {
    const counts = emptyCounts();
    const { empByName, created } = await resolveOrCreateEmployees(q as ApplyQuery, batchId, orgId);
    counts.employeesCreated = created;
    await applySales(q as ApplyQuery, batchId, sources, empByName, counts);
    await applySchedules(q as ApplyQuery, batchId, sources, empByName, counts);
    await applyPlans(q as ApplyQuery, batchId, sources, empByName, counts);
    await applyCash(q as ApplyQuery, batchId, sources, counts);
    return counts;
  });
}
