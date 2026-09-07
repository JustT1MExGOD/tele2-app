import { parseCsv } from './csv.js';
import { canonicalEmployeeName } from './employees.js';
import { canonicalMetricId } from './metrics.js';

export interface DailyFactRow {
  employeeName: string;
  date: string;
  metrics: Record<string, number>; // canonical metric id -> value
}

/** Aggregates t2_legacy_daily_facts.csv into one row per employee/date. */
export function loadDailyFacts(csvText: string): DailyFactRow[] {
  const byKey = new Map<string, DailyFactRow>();
  const unmapped: string[] = [];
  for (const row of parseCsv(csvText)) {
    if (row.record_type !== 'daily_fact') continue;
    const employeeName = canonicalEmployeeName(row.employee_name);
    const date = row.date;
    if (!date) continue;
    const metricId = canonicalMetricId(row.metric);
    if (!metricId) {
      unmapped.push(row.metric);
      continue;
    }
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    const k = `${employeeName} ${date}`;
    let entry = byKey.get(k);
    if (!entry) {
      entry = { employeeName, date, metrics: {} };
      byKey.set(k, entry);
    }
    entry.metrics[metricId] = (entry.metrics[metricId] ?? 0) + value;
  }
  if (unmapped.length > 0) {
    throw new Error(
      `daily_facts.csv contains ${unmapped.length} rows with unmapped metric literals: ${[...new Set(unmapped)].join(', ')}`
    );
  }
  return [...byKey.values()];
}
