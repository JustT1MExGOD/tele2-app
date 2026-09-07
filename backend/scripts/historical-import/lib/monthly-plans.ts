import { parseCsv } from './csv.js';
import { canonicalEmployeeName } from './employees.js';
import { canonicalMetricId } from './metrics.js';

export interface MonthlyPlanRow {
  employeeName: string;
  month: string; // YYYY-MM
  metrics: Record<string, number>;
}

/** Loads t2_legacy_monthly_plans.csv (targets, distinct from monthly_actuals_source). */
export function loadMonthlyPlans(csvText: string): MonthlyPlanRow[] {
  const byKey = new Map<string, MonthlyPlanRow>();
  const unmapped: string[] = [];
  for (const row of parseCsv(csvText)) {
    if (row.record_type !== 'monthly_plan') continue;
    const employeeName = canonicalEmployeeName(row.employee_name);
    const month = row.month;
    if (!month) continue;
    const metricId = canonicalMetricId(row.metric);
    if (!metricId) {
      unmapped.push(row.metric);
      continue;
    }
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    const k = `${employeeName} ${month}`;
    let entry = byKey.get(k);
    if (!entry) {
      entry = { employeeName, month, metrics: {} };
      byKey.set(k, entry);
    }
    entry.metrics[metricId] = (entry.metrics[metricId] ?? 0) + value;
  }
  if (unmapped.length > 0) {
    throw new Error(
      `monthly_plans.csv contains ${unmapped.length} rows with unmapped metric literals: ${[...new Set(unmapped)].join(', ')}`
    );
  }
  return [...byKey.values()];
}
