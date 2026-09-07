/**
 * Historical import — REAL APPLY.
 *
 * This is the only script in scripts/historical-import that writes
 * anything. It refuses to run unless BOTH:
 *   1. `--apply` is passed, and
 *   2. `--confirm-production <token>` is passed, where <token> equals the
 *      first 16 hex chars of the CURRENT source bundle's SHA-256
 *      fingerprint (printed by dry-run.ts). This ties confirmation to the
 *      exact data being imported — an operator can't approve a bundle
 *      they haven't actually seen the dry-run report for, and the token
 *      changes the instant any source CSV changes.
 *
 * Without both flags present and matching, this script exits before
 * opening a database connection at all.
 *
 * Usage:
 *   npx tsx scripts/historical-import/apply.ts --apply --confirm-production <token>
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { loadDailyFacts } from './lib/daily-facts.js';
import { loadMayJulSchedule, loadAprilSchedule, mergeScheduleIndexes } from './lib/schedule-index.js';
import { loadMayJulSchedulePlan, loadAprilSchedulePlan } from './lib/schedules-import.js';
import { resolveStore } from './lib/resolve-store.js';
import { loadMonthlyPlans } from './lib/monthly-plans.js';
import { loadCashPlan } from './lib/cash.js';
import { computeSourceFingerprint } from './lib/fingerprint.js';
// NOTE: apply-engine.js is intentionally NOT statically imported here. It
// transitively imports src/data/db/index.js, whose connection pool reads
// DATABASE_URL (and decides TLS behavior from it) at MODULE LOAD time. A
// static import would evaluate that pool before this file's own top-level
// code (below) gets a chance to normalize DATABASE_URL for the Railway
// proxy's self-signed cert (sslmode=no-verify) — a static import runs
// before any sibling top-level statement, regardless of source order. So
// the DATABASE_URL fix-up happens first, then apply-engine.js is loaded
// via a dynamic import() inside main(), once the URL is already correct.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, 'source');
const src = (name: string) => readFileSync(path.join(sourceDir, name), 'utf8');

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const idx = argv.indexOf('--confirm-production');
  const confirmToken = idx >= 0 ? argv[idx + 1] : null;
  return { apply, confirmToken };
}

async function main() {
  const { apply, confirmToken } = parseArgs(process.argv.slice(2));
  const fingerprint = computeSourceFingerprint(sourceDir);
  const expectedToken = fingerprint.slice(0, 16);

  if (!apply) {
    console.log('Refusing to run: --apply not passed. This was a no-op (nothing connected, nothing written).');
    console.log('Expected --confirm-production token for the current source bundle:', expectedToken);
    process.exit(1);
  }
  if (confirmToken !== expectedToken) {
    console.error('Refusing to run: --confirm-production token missing or does not match the current source bundle fingerprint.');
    console.error('Expected:', expectedToken, ' got:', confirmToken ?? '(none)');
    console.error('Run dry-run.ts first and copy the printed token exactly — this proves you reviewed THIS exact data.');
    process.exit(1);
  }

  let url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  // Normalize DATABASE_URL BEFORE anything imports src/data/db/index.js
  // (transitively, via apply-engine.js below) — that module builds its
  // pg.Pool from process.env.DATABASE_URL at module-load time, so this
  // must happen first, and apply-engine.js must only be loaded afterward.
  if (url.includes('railway') && !/[?&]sslmode=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'sslmode=no-verify';
    process.env.DATABASE_URL = url;
  }
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('railway') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  const { applyHistoricalImportBatch } = await import('./lib/apply-engine.js');

  try {
    const dailyFacts = loadDailyFacts(src('t2_legacy_daily_facts.csv'));

    // org_id for new historical employees is derived ONLY from the
    // employees THIS dataset actually matches, not from the whole
    // employees table — production now spans multiple org_id values
    // (e.g. 'default' and 'rtt_gureeva' for a different team), so
    // requiring global agreement would wrongly refuse to run. Must match
    // dry-run.ts's identical derivation exactly, or the dry-run report's
    // "would create under org_id=X" could silently diverge from what
    // apply actually does.
    const employeeNames = [...new Set(dailyFacts.map((f) => f.employeeName))];
    const empRes = await client.query('SELECT full_name, org_id FROM employees');
    const matchedOrgIds = new Set(
      empRes.rows.filter((r: any) => employeeNames.includes(r.full_name)).map((r: any) => r.org_id)
    );
    if (matchedOrgIds.size !== 1) {
      throw new Error(
        `Refusing to guess org_id for new historical employees: the ${matchedOrgIds.size} existing employees this dataset matches span ${matchedOrgIds.size} distinct org_id values (${[...matchedOrgIds].join(', ')}). ` +
        `This script only auto-derives org_id when every existing employee this dataset matches agrees on one value.`
      );
    }
    const orgId = [...matchedOrgIds][0] as string;

    const scheduleIdx = mergeScheduleIndexes(
      loadMayJulSchedule(src('t2_legacy_schedules.csv')),
      loadAprilSchedule(src('t2_april_schedule.csv'))
    );
    const resolutions = dailyFacts.map((f) => resolveStore(f.employeeName, f.date, scheduleIdx));
    const schedulePlanRows = [
      ...loadMayJulSchedulePlan(src('t2_legacy_schedules.csv')),
      ...loadAprilSchedulePlan(src('t2_april_schedule.csv')),
    ];
    const monthlyPlans = loadMonthlyPlans(src('t2_legacy_monthly_plans.csv'));
    const cashPlan = loadCashPlan(src('t2_legacy_cash.csv'));

    const conflicts = resolutions.filter((r) => r.category === 'NO_STORE_NO_SCHEDULE' || r.category === 'NO_STORE_DAY_OFF_CONFLICT');
    if (conflicts.length > 0) {
      throw new Error(`Refusing to apply: ${conflicts.length} unresolved NO_STORE/CONFLICT rows remain. Run dry-run.ts and resolve first.`);
    }

    const batchId = `historical-import-${randomUUID()}`;
    console.log('Applying batch', batchId, 'orgId', orgId);

    const counts = await applyHistoricalImportBatch(
      { dailyFacts, resolutions, schedulePlanRows, monthlyPlans, cashPlan },
      batchId,
      orgId
    );

    console.log('=== APPLY COMPLETE ===');
    console.log('batchId:', batchId);
    console.log(counts);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('APPLY FAILED (transaction rolled back, nothing partially written):', e);
  process.exit(1);
});
