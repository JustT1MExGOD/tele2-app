/**
 * Historical import — production dry-run (read-only, NOT --apply).
 *
 * Only SELECTs are issued against production. This script has no write
 * path at all — the real write path lives in lib/apply-engine.ts /
 * apply.ts, a separate file with its own explicit safety switches, never
 * invoked from here.
 *
 * Usage: DATABASE_URL=<prod, from backend/.env.test> npx tsx scripts/historical-import/dry-run.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { loadDailyFacts } from './lib/daily-facts.js';
import { recomputeReconciliation } from './lib/reconciliation.js';
import { loadMayJulSchedule, loadAprilSchedule, mergeScheduleIndexes } from './lib/schedule-index.js';
import { loadMayJulSchedulePlan, loadAprilSchedulePlan } from './lib/schedules-import.js';
import { resolveStore } from './lib/resolve-store.js';
import { loadMonthlyPlans } from './lib/monthly-plans.js';
import { loadCashPlan } from './lib/cash.js';
import { METRIC_COLS, diffSales, diffSchedules, diffPlans, diffCash } from './lib/diff.js';
import { HISTORICAL_EMPLOYEES_TO_CREATE } from './lib/historical-employees.js';
import { computeSourceFingerprint } from './lib/fingerprint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, 'source');
const src = (name: string) => readFileSync(path.join(sourceDir, name), 'utf8');

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

    // ---- load sources ----
    const dailyFacts = loadDailyFacts(src('t2_legacy_daily_facts.csv'));
    const recon = recomputeReconciliation(src('t2_legacy_monthly_actuals_source.csv'), dailyFacts);
    const scheduleIdx = mergeScheduleIndexes(
      loadMayJulSchedule(src('t2_legacy_schedules.csv')),
      loadAprilSchedule(src('t2_april_schedule.csv'))
    );
    const schedulePlanRows = [
      ...loadMayJulSchedulePlan(src('t2_legacy_schedules.csv')),
      ...loadAprilSchedulePlan(src('t2_april_schedule.csv')),
    ];
    const monthlyPlans = loadMonthlyPlans(src('t2_legacy_monthly_plans.csv'));
    const cashPlan = loadCashPlan(src('t2_legacy_cash.csv'));

    // ---- store resolution over every daily_fact employee/date ----
    const resolutions = dailyFacts.map((f) => resolveStore(f.employeeName, f.date, scheduleIdx));
    const byCategory: Record<string, number> = {};
    for (const r of resolutions) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

    const storeResolved =
      (byCategory.STORE_RESOLVED_SCHEDULE ?? 0) +
      (byCategory.STORE_RESOLVED_USER_CONFIRMED ?? 0) +
      (byCategory.TECHNICAL_FACT_ON_DAY_OFF ?? 0);
    const scheduleSourceCount = byCategory.STORE_RESOLVED_SCHEDULE ?? 0;
    const userConfirmedCount = byCategory.STORE_RESOLVED_USER_CONFIRMED ?? 0;
    const technicalFactCount = byCategory.TECHNICAL_FACT_ON_DAY_OFF ?? 0;
    const noStore = byCategory.NO_STORE_NO_SCHEDULE ?? 0;
    const conflict = byCategory.NO_STORE_DAY_OFF_CONFLICT ?? 0;

    // ---- employees: existing match + would-create simulation ----
    const employeeNames = [...new Set(dailyFacts.map((f) => f.employeeName))].sort();
    const empRes = await client.query('SELECT id, full_name, org_id FROM employees');
    const empByName = new Map<string, number>(empRes.rows.map((r: any) => [r.full_name, Number(r.id)]));
    const matchedEmployees = employeeNames.filter((n) => empByName.has(n));
    const unmatchedInDailyFacts = employeeNames.filter((n) => !empByName.has(n));

    // org_id for new historical employees: confirmed as 'default' — every
    // one of the already-matched employees in this dataset is org_id='default'.
    const orgIdRows = empRes.rows.filter((r: any) => matchedEmployees.includes(r.full_name));
    const orgIds = new Set(orgIdRows.map((r: any) => r.org_id));
    const historicalOrgId = orgIds.size === 1 ? [...orgIds][0] : 'default';

    const employeesWouldCreate = HISTORICAL_EMPLOYEES_TO_CREATE.filter((n) => !empByName.has(n));
    const employeesAlreadyExist = HISTORICAL_EMPLOYEES_TO_CREATE.filter((n) => empByName.has(n));

    // Simulate creation in a local copy of empByName so downstream diffs
    // reflect what apply.ts would actually see after employee creation —
    // matches the real apply-engine.ts flow exactly (SELECT -> create
    // missing -> diff dependent tables), except no row is ever written here.
    const simulatedEmpByName = new Map(empByName);
    let simulatedNextId = -1; // negative placeholder ids, never collide with real bigserial ids
    for (const name of employeesWouldCreate) {
      simulatedEmpByName.set(name, simulatedNextId--);
    }

    // ---- sales diff ----
    const existingSales = await client.query(
      `SELECT employee_id, store_id, sale_date, ${METRIC_COLS.join(', ')}
       FROM sales WHERE sale_date BETWEEN '2026-04-01' AND '2026-07-31'`
    );
    const salesDiff = diffSales(existingSales.rows, dailyFacts, resolutions, simulatedEmpByName);
    const salesCounts = count(salesDiff);

    // ---- schedules diff ----
    const existingSchedules = await client.query(
      `SELECT employee_id, work_date, store_id, shift_text, hours
       FROM schedules WHERE work_date BETWEEN '2026-04-01' AND '2026-07-31'`
    );
    const scheduleDiff = diffSchedules(existingSchedules.rows, schedulePlanRows, simulatedEmpByName);
    const scheduleCounts = count(scheduleDiff);

    // ---- employee_month_plans diff ----
    const existingPlans = await client.query(
      `SELECT employee_id, month, ${METRIC_COLS.join(', ')}
       FROM employee_month_plans WHERE month BETWEEN '2026-04-01' AND '2026-07-31'`
    );
    const plansDiff = diffPlans(existingPlans.rows, monthlyPlans, simulatedEmpByName);
    const plansCounts = count(plansDiff);

    // ---- store_cash diff ----
    const existingCash = await client.query(
      `SELECT store_id, cash_date, cash_fact, cash_1c
       FROM store_cash WHERE cash_date BETWEEN '2026-04-01' AND '2026-07-31'`
    );
    const cashDiff = diffCash(existingCash.rows, cashPlan);
    const cashCounts = count(cashDiff);
    const cashSkipWithWarning = cashPlan.filter((r) => r.category === 'SKIP_WITH_WARNING').length;

    const reconCounts: Record<string, number> = {};
    for (const r of recon) reconCounts[r.status] = (reconCounts[r.status] ?? 0) + 1;

    const readyToApply =
      conflict === 0 &&
      noStore === 0 &&
      (reconCounts.MISMATCH ?? 0) === 0;

    // ---- report ----
    console.log('=== HISTORICAL IMPORT — PRODUCTION DRY-RUN (read-only, NOT --apply) ===\n');
    console.log('SOURCE_FINGERPRINT (sha256):', fingerprint);
    console.log('  -> apply.ts --confirm-production expects:', fingerprint.slice(0, 16), '\n');

    console.log('--- Store resolution (sales daily employee/date) ---');
    console.log('TOTAL:', dailyFacts.length);
    console.log('STORE_RESOLVED:', storeResolved);
    console.log('  SCHEDULE_SOURCE:', scheduleSourceCount);
    console.log('  USER_CONFIRMED:', userConfirmedCount);
    console.log('  TECHNICAL_FACT_ON_DAY_OFF:', technicalFactCount);
    console.log('NO_STORE:', noStore);
    console.log('CONFLICTS:', conflict);

    console.log('\n--- Reconciliation ---');
    console.log('PASS:', reconCounts.PASS ?? 0, ' TRUE_NO_DAILY_DATA:', reconCounts.TRUE_NO_DAILY_DATA ?? 0, ' MISMATCH:', reconCounts.MISMATCH ?? 0);

    console.log('\n--- Employees ---');
    console.log('distinct names in daily_facts:', employeeNames.length);
    console.log('EMPLOYEES_MATCHED_EXISTING:', matchedEmployees.length, matchedEmployees);
    console.log('unmatched in daily_facts (not the 4 historical-creation set; anything here is unexpected):', unmatchedInDailyFacts.filter((n) => !HISTORICAL_EMPLOYEES_TO_CREATE.includes(n)));
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

    console.log('\n--- employee_month_plans ---');
    console.log('PLANS_WOULD_INSERT:', plansCounts.INSERT);
    console.log('PLANS_WOULD_UPDATE_IDENTICAL:', plansCounts.UPDATE_IDENTICAL);
    console.log('PLANS_WOULD_UPDATE_DIFFERENT:', plansCounts.UPDATE_DIFFERENT);
    console.log('PLANS_SOURCE_ONLY (employee not matched/created):', plansCounts.SOURCE_ONLY);

    console.log('\n--- store_cash ---');
    console.log('CASH_WOULD_INSERT:', cashCounts.INSERT);
    console.log('CASH_WOULD_UPDATE_IDENTICAL:', cashCounts.UPDATE_IDENTICAL);
    console.log('CASH_WOULD_UPDATE_DIFFERENT:', cashCounts.UPDATE_DIFFERENT);
    console.log('SKIP_WITH_WARNING (incomplete cash_1c/cash_actual pair):', cashSkipWithWarning);

    console.log('\n--- BFQ ---');
    console.log('BFQ_SOURCE_ONLY (reference only, never imported):', 'see t2_legacy_bfq.csv');

    console.log('\n=== VERDICT ===');
    console.log(readyToApply ? 'READY_TO_APPLY' : 'BLOCKED — unresolved NO_STORE/CONFLICT/MISMATCH remain');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
