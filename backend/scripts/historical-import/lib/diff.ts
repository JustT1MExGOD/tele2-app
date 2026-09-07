/**
 * Pure diff functions shared by dry-run.ts (read-only reporting) and
 * apply-engine.ts (real writes). Kept in one place so the dry-run report
 * and the real apply can never silently diverge in what counts as
 * WOULD_INSERT/WOULD_UPDATE_IDENTICAL/WOULD_UPDATE_DIFFERENT — both call
 * the exact same classification logic against the exact same existing-row
 * shape, only apply-engine.ts goes on to actually write.
 */
import { SALES_METRIC_COLUMNS } from './metrics.js';
import type { DailyFactRow } from './daily-facts.js';
import type { StoreResolution } from './resolve-store.js';
import type { SchedulePlanRow } from './schedules-import.js';
import type { MonthlyPlanRow } from './monthly-plans.js';
import type { CashPlanRow } from './cash.js';

const METRIC_COLS = [...SALES_METRIC_COLUMNS];

export type DiffKind = 'INSERT' | 'UPDATE_IDENTICAL' | 'UPDATE_DIFFERENT' | 'SOURCE_ONLY';

export interface SalesDiffRow {
  kind: DiffKind;
  employeeId: number | null;
  storeId: string | null;
  date: string;
  metrics: Record<string, number>;
  before: Record<string, unknown> | null;
  fact: DailyFactRow;
  resolution: StoreResolution;
}

export function diffSales(
  existingRows: any[],
  dailyFacts: DailyFactRow[],
  resolutions: StoreResolution[],
  empByName: Map<string, number>
): SalesDiffRow[] {
  const byKey = new Map<string, any>(
    existingRows.map((r) => [`${r.employee_id}|${r.store_id}|${r.sale_date}`, r])
  );
  const out: SalesDiffRow[] = [];
  for (let i = 0; i < dailyFacts.length; i++) {
    const fact = dailyFacts[i];
    const resolution = resolutions[i];
    const employeeId = empByName.get(fact.employeeName) ?? null;
    if (!resolution.storeId || !employeeId) {
      out.push({
        kind: 'SOURCE_ONLY', employeeId, storeId: resolution.storeId, date: fact.date,
        metrics: fact.metrics, before: null, fact, resolution,
      });
      continue;
    }
    const metricsRow: Record<string, number> = {};
    for (const col of METRIC_COLS) metricsRow[col] = fact.metrics[col] ?? 0;
    const existing = byKey.get(`${employeeId}|${resolution.storeId}|${fact.date}`);
    if (!existing) {
      out.push({ kind: 'INSERT', employeeId, storeId: resolution.storeId, date: fact.date, metrics: metricsRow, before: null, fact, resolution });
      continue;
    }
    const identical = METRIC_COLS.every((c) => Math.abs(metricsRow[c] - Number(existing[c] ?? 0)) < 0.005);
    out.push({
      kind: identical ? 'UPDATE_IDENTICAL' : 'UPDATE_DIFFERENT',
      employeeId, storeId: resolution.storeId, date: fact.date, metrics: metricsRow, before: existing, fact, resolution,
    });
  }
  return out;
}

export interface ScheduleDiffRow {
  kind: DiffKind;
  employeeId: number | null;
  row: SchedulePlanRow;
  before: any | null;
}

export function diffSchedules(
  existingRows: any[],
  schedulePlanRows: SchedulePlanRow[],
  empByName: Map<string, number>
): ScheduleDiffRow[] {
  const byKey = new Map<string, any>(existingRows.map((r) => [`${r.employee_id}|${r.work_date}`, r]));
  const out: ScheduleDiffRow[] = [];
  for (const row of schedulePlanRows) {
    const employeeId = empByName.get(row.employeeName) ?? null;
    if (!employeeId) {
      out.push({ kind: 'SOURCE_ONLY', employeeId: null, row, before: null });
      continue;
    }
    const existing = byKey.get(`${employeeId}|${row.date}`);
    if (!existing) {
      out.push({ kind: 'INSERT', employeeId, row, before: null });
      continue;
    }
    const identical =
      existing.store_id === row.storeId && existing.shift_text === row.shiftText && Number(existing.hours) === row.hours;
    out.push({ kind: identical ? 'UPDATE_IDENTICAL' : 'UPDATE_DIFFERENT', employeeId, row, before: existing });
  }
  return out;
}

export interface PlanDiffRow {
  kind: DiffKind;
  employeeId: number | null;
  month: string;
  metrics: Record<string, number>;
  before: any | null;
  row: MonthlyPlanRow;
}

export function diffPlans(
  existingRows: any[],
  monthlyPlans: MonthlyPlanRow[],
  empByName: Map<string, number>
): PlanDiffRow[] {
  const byKey = new Map<string, any>(existingRows.map((r) => [`${r.employee_id}|${r.month}`, r]));
  const out: PlanDiffRow[] = [];
  for (const row of monthlyPlans) {
    const employeeId = empByName.get(row.employeeName) ?? null;
    const month = `${row.month}-01`;
    if (!employeeId) {
      out.push({ kind: 'SOURCE_ONLY', employeeId: null, month, metrics: row.metrics, before: null, row });
      continue;
    }
    const metricsRow: Record<string, number> = {};
    for (const col of METRIC_COLS) metricsRow[col] = row.metrics[col] ?? 0;
    const existing = byKey.get(`${employeeId}|${month}`);
    if (!existing) {
      out.push({ kind: 'INSERT', employeeId, month, metrics: metricsRow, before: null, row });
      continue;
    }
    const identical = METRIC_COLS.every((c) => Math.abs(metricsRow[c] - Number(existing[c] ?? 0)) < 0.005);
    out.push({ kind: identical ? 'UPDATE_IDENTICAL' : 'UPDATE_DIFFERENT', employeeId, month, metrics: metricsRow, before: existing, row });
  }
  return out;
}

export interface CashDiffRow {
  kind: DiffKind;
  row: CashPlanRow;
  before: any | null;
}

export function diffCash(existingRows: any[], cashPlan: CashPlanRow[]): CashDiffRow[] {
  const byKey = new Map<string, any>(existingRows.map((r) => [`${r.store_id}|${r.cash_date}`, r]));
  const out: CashDiffRow[] = [];
  for (const row of cashPlan) {
    if (row.category !== 'IMPORTABLE') {
      out.push({ kind: 'SOURCE_ONLY', row, before: null }); // SKIP_WITH_WARNING, reported separately
      continue;
    }
    const existing = byKey.get(`${row.storeId}|${row.cashDate}`);
    if (!existing) {
      out.push({ kind: 'INSERT', row, before: null });
      continue;
    }
    const identical =
      Math.abs((row.cashFact as number) - Number(existing.cash_fact)) < 0.005 &&
      Math.abs((row.cash1c as number) - Number(existing.cash_1c)) < 0.005;
    out.push({ kind: identical ? 'UPDATE_IDENTICAL' : 'UPDATE_DIFFERENT', row, before: existing });
  }
  return out;
}

export { METRIC_COLS };
