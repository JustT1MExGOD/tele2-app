/**
 * The real write path for the NEW-SOURCES historical import batch
 * (Nov 2025 - Mar 2026: sales + schedules only, parsed from the 4 new
 * Excel files). Kept as a separate module from lib/apply-engine.ts (the
 * original April-July batch, which also handles plans/cash) rather than
 * generalizing it, since this batch has no monthly-plan/cash source data
 * at all yet — mixing the two would make it possible to accidentally
 * apply one batch's date range against the other's table set.
 *
 * Same hard guarantees as lib/apply-engine.ts: raw SQL only against
 * `sales`/`schedules`/`employees`, no application service calls (no
 * shift/clock-in code, no XP/gamification, no notifications), one
 * withTransaction wrapping the whole batch plus its import_ledger
 * entries, diff classification reused unchanged from lib/diff.ts so the
 * dry-run report and this apply path can never diverge.
 */
import { withTransaction } from '../../../src/data/db/index.js';
import { recordLedgerEntry } from './ledger.js';
import { insertHistoricalEmployee } from './historical-employees.js';
import { METRIC_COLS, diffSales, diffSchedules } from './diff.js';
import type { DailyFactRow } from './daily-facts.js';
import type { StoreResolution } from './resolve-store.js';
import type { SchedulePlanRow } from './schedules-import.js';

export type ApplyQuery = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export interface ApplySourcesNew {
  dailyFacts: DailyFactRow[];
  resolutions: StoreResolution[]; // same length/order as dailyFacts
  schedulePlanRows: SchedulePlanRow[];
}

export interface ApplyCountsNew {
  employeesCreated: number;
  salesInserted: number;
  salesUpdated: number;
  salesSkippedIdentical: number;
  scheduleInserted: number;
  scheduleUpdated: number;
  scheduleSkippedIdentical: number;
}

function emptyCounts(): ApplyCountsNew {
  return {
    employeesCreated: 0,
    salesInserted: 0, salesUpdated: 0, salesSkippedIdentical: 0,
    scheduleInserted: 0, scheduleUpdated: 0, scheduleSkippedIdentical: 0,
  };
}

async function resolveOrCreateEmployees(
  q: ApplyQuery,
  batchId: string,
  orgId: string,
  employeesToCreate: readonly string[]
): Promise<{ empByName: Map<string, number>; created: number }> {
  const empRes = await q('SELECT id, full_name FROM employees');
  const empByName = new Map<string, number>(empRes.rows.map((r: any) => [r.full_name, Number(r.id)]));
  let created = 0;
  for (const name of employeesToCreate) {
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

async function applySales(
  q: ApplyQuery, batchId: string, sources: ApplySourcesNew, empByName: Map<string, number>,
  counts: ApplyCountsNew, dateFrom: string, dateTo: string
) {
  const existing = await q(
    `SELECT employee_id, store_id, sale_date, ${METRIC_COLS.join(', ')}
     FROM sales WHERE sale_date BETWEEN $1 AND $2`,
    [dateFrom, dateTo]
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

async function applySchedules(
  q: ApplyQuery, batchId: string, sources: ApplySourcesNew, empByName: Map<string, number>,
  counts: ApplyCountsNew, dateFrom: string, dateTo: string
) {
  const existing = await q(
    `SELECT employee_id, work_date, store_id, shift_text, hours
     FROM schedules WHERE work_date BETWEEN $1 AND $2`,
    [dateFrom, dateTo]
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

/**
 * Applies the new-sources historical import batch as one transaction.
 * `dateFrom`/`dateTo` scope both the existing-row SELECTs and (indirectly,
 * via the diff functions receiving only in-range source rows) the writes —
 * callers must pass sources already filtered to this batch's own window,
 * never the full merged source set.
 */
export async function applyNewHistoricalImportBatch(
  sources: ApplySourcesNew,
  batchId: string,
  orgId: string,
  employeesToCreate: readonly string[],
  dateFrom: string,
  dateTo: string
): Promise<ApplyCountsNew> {
  return withTransaction(async (q) => {
    const counts = emptyCounts();
    const { empByName, created } = await resolveOrCreateEmployees(q as ApplyQuery, batchId, orgId, employeesToCreate);
    counts.employeesCreated = created;
    await applySales(q as ApplyQuery, batchId, sources, empByName, counts, dateFrom, dateTo);
    await applySchedules(q as ApplyQuery, batchId, sources, empByName, counts, dateFrom, dateTo);
    return counts;
  });
}
