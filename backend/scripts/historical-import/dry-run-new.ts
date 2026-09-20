/**
 * Historical import — production dry-run for the NEW sources (read-only,
 * NOT --apply): Nov 2025 – Mar 2026 daily facts + schedules, parsed from
 * "Планы дневные"/"График" sheets in the 4 new Excel files (see
 * parse_new_schedules.py / parse_new_daily_facts.py).
 *
 * Deliberately a SEPARATE batch from dry-run.ts/apply-engine.ts's
 * 2026-04-01..2026-07-31 window: separate source dir (source-new/, so its
 * fingerprint never mixes with the original batch's source/), separate
 * date range, sales+schedules only (no monthly-plan/cash CSVs exist yet
 * for these files — out of scope for this pass).
 *
 * Usage: DATABASE_URL=<prod, from backend/.env.test> npx tsx scripts/historical-import/dry-run-new.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { loadDailyFacts } from './lib/daily-facts.js';
import { loadAprilSchedule } from './lib/schedule-index.js';
import { loadAprilSchedulePlan } from './lib/schedules-import.js';
import { resolveStore, type StoreResolution } from './lib/resolve-store.js';
import { findNewBatchOverride } from './lib/overrides-new.js';
import { METRIC_COLS, diffSales, diffSchedules } from './lib/diff.js';
import { computeSourceFingerprint } from './lib/fingerprint.js';

/** Checks the new-batch overrides (40 technical entries, user-confirmed
 * "по ближайшему рабочему дню") before falling back to schedule-based
 * resolution — mirrors resolveStore()'s own override-first structure. */
function resolveStoreNew(employeeName: string, date: string, scheduleIndex: Parameters<typeof resolveStore>[2]): StoreResolution {
  const override = findNewBatchOverride(employeeName, date);
  if (override) {
    return {
      employeeName,
      date,
      storeId: override.storeId,
      category: 'TECHNICAL_FACT_ON_DAY_OFF',
      resolutionSource: override.resolutionSource,
      resolutionReason: override.resolutionReason,
    };
  }
  return resolveStore(employeeName, date, scheduleIndex);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, 'source-new');
const src = (name: string) => readFileSync(path.join(sourceDir, name), 'utf8');

const DATE_FROM = '2025-11-01';
const DATE_TO = '2026-03-31';

// The 3 of 9 new-file employees confirmed (read-only query, 2026-09-12)
// not present in production `employees`. The other 6 (Баранова, Бижонов,
// Каравашков, Степанов, Тутаев, Чернова) already exist.
const NEW_HISTORICAL_EMPLOYEES_TO_CREATE: readonly string[] = [
  'Вурсол Павел Алексеевич',
  'Петрова Екатерина Андреевна',
  'Самохина Ольга Васильевна',
];

function count<T extends string>(rows: { kind: T }[]) {
  const c: Record<string, number> = { INSERT: 0, UPDATE_IDENTICAL: 0, UPDATE_DIFFERENT: 0, SOURCE_ONLY: 0 };
  for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
  return c;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set (expected backend/.env.test, production, read-only)');
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('railway') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const fingerprint = computeSourceFingerprint(sourceDir);

    const dailyFacts = loadDailyFacts(src('t2_new_daily_facts.csv'));
    const scheduleIdx = loadAprilSchedule(src('t2_new_schedules.csv'));
    const schedulePlanRows = loadAprilSchedulePlan(src('t2_new_schedules.csv'));

    const resolutions = dailyFacts.map((f) => resolveStoreNew(f.employeeName, f.date, scheduleIdx));
    const byCategory: Record<string, number> = {};
    for (const r of resolutions) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

    const storeResolved =
      (byCategory.STORE_RESOLVED_SCHEDULE ?? 0) +
      (byCategory.STORE_RESOLVED_USER_CONFIRMED ?? 0) +
      (byCategory.TECHNICAL_FACT_ON_DAY_OFF ?? 0);
    const noStore = byCategory.NO_STORE_NO_SCHEDULE ?? 0;
    const conflict = byCategory.NO_STORE_DAY_OFF_CONFLICT ?? 0;

    const employeeNames = [...new Set(dailyFacts.map((f) => f.employeeName))].sort();
    const empRes = await client.query('SELECT id, full_name, org_id FROM employees');
    const empByName = new Map<string, number>(empRes.rows.map((r: any) => [r.full_name, Number(r.id)]));
    const matchedEmployees = employeeNames.filter((n) => empByName.has(n));
    const unmatchedInDailyFacts = employeeNames.filter((n) => !empByName.has(n));

    const orgIdRows = empRes.rows.filter((r: any) => matchedEmployees.includes(r.full_name));
    const orgIds = new Set(orgIdRows.map((r: any) => r.org_id));
    const historicalOrgId = orgIds.size === 1 ? [...orgIds][0] : 'default';

    const employeesWouldCreate = NEW_HISTORICAL_EMPLOYEES_TO_CREATE.filter((n) => !empByName.has(n));
    const employeesAlreadyExist = NEW_HISTORICAL_EMPLOYEES_TO_CREATE.filter((n) => empByName.has(n));

    const simulatedEmpByName = new Map(empByName);
    let simulatedNextId = -1;
    for (const name of employeesWouldCreate) simulatedEmpByName.set(name, simulatedNextId--);

    const existingSales = await client.query(
      `SELECT employee_id, store_id, sale_date, ${METRIC_COLS.join(', ')}
       FROM sales WHERE sale_date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'`
    );
    const salesDiff = diffSales(existingSales.rows, dailyFacts, resolutions, simulatedEmpByName);
    const salesCounts = count(salesDiff);

    const existingSchedules = await client.query(
      `SELECT employee_id, work_date, store_id, shift_text, hours
       FROM schedules WHERE work_date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'`
    );
    const scheduleDiff = diffSchedules(existingSchedules.rows, schedulePlanRows, simulatedEmpByName);
    const scheduleCounts = count(scheduleDiff);

    const readyToApply = conflict === 0 && noStore === 0;

    console.log('=== HISTORICAL IMPORT (NEW SOURCES: Nov 2025 - Mar 2026) — PRODUCTION DRY-RUN (read-only, NOT --apply) ===\n');
    console.log('SOURCE_FINGERPRINT (sha256):', fingerprint);
    console.log('  -> apply-new.ts --confirm-production would expect:', fingerprint.slice(0, 16), '\n');

    console.log('--- Store resolution (sales daily employee/date) ---');
    console.log('TOTAL:', dailyFacts.length);
    console.log('STORE_RESOLVED:', storeResolved);
    console.log('  SCHEDULE_SOURCE:', byCategory.STORE_RESOLVED_SCHEDULE ?? 0);
    console.log('  USER_CONFIRMED:', byCategory.STORE_RESOLVED_USER_CONFIRMED ?? 0);
    console.log('  TECHNICAL_FACT_ON_DAY_OFF:', byCategory.TECHNICAL_FACT_ON_DAY_OFF ?? 0);
    console.log('NO_STORE:', noStore);
    console.log('CONFLICTS:', conflict);

    console.log('\n--- Employees ---');
    console.log('distinct names in daily_facts:', employeeNames.length);
    console.log('EMPLOYEES_MATCHED_EXISTING:', matchedEmployees.length, matchedEmployees);
    console.log('unmatched in daily_facts (not the 3 historical-creation set; anything here is unexpected):', unmatchedInDailyFacts.filter((n) => !NEW_HISTORICAL_EMPLOYEES_TO_CREATE.includes(n)));
    console.log('EMPLOYEES_WOULD_CREATE:', employeesWouldCreate.length, employeesWouldCreate, '(org_id=' + historicalOrgId + ')');
    if (employeesAlreadyExist.length) console.log('already exist (re-run is idempotent for these):', employeesAlreadyExist);

    console.log('\n--- sales ---');
    console.log('SALES_WOULD_INSERT:', salesCounts.INSERT);
    console.log('SALES_WOULD_UPDATE_IDENTICAL:', salesCounts.UPDATE_IDENTICAL);
    console.log('SALES_WOULD_UPDATE_DIFFERENT:', salesCounts.UPDATE_DIFFERENT);
    console.log('SALES_SOURCE_ONLY:', salesCounts.SOURCE_ONLY);

    console.log('\n--- schedules ---');
    console.log('SCHEDULES_WOULD_INSERT:', scheduleCounts.INSERT);
    console.log('SCHEDULES_WOULD_UPDATE_IDENTICAL:', scheduleCounts.UPDATE_IDENTICAL);
    console.log('SCHEDULES_WOULD_UPDATE_DIFFERENT:', scheduleCounts.UPDATE_DIFFERENT);
    console.log('SCHEDULES_SOURCE_ONLY (employee not matched/created):', scheduleCounts.SOURCE_ONLY);

    console.log('\n--- Out of scope for this pass (not parsed/loaded) ---');
    console.log('employee_month_plans: skipped (no monthly-plan CSV built for the new files yet)');
    console.log('store_cash: skipped (no cash CSV built for the new files yet)');
    console.log("March 'Общее план' personal-plan table (rows ~15-27): not parsed, open question, not imported anywhere");

    console.log('\n=== VERDICT ===');
    console.log(readyToApply ? 'READY_TO_APPLY (sales+schedules only)' : 'BLOCKED — unresolved NO_STORE/CONFLICT remain');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
