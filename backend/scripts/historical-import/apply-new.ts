/**
 * Historical import — REAL APPLY for the NEW SOURCES batch (Nov 2025 -
 * Mar 2026, sales + schedules only).
 *
 * Same safety gate as apply.ts: refuses to run unless BOTH `--apply` and
 * `--confirm-production <token>` are passed, where <token> is the first
 * 16 hex chars of computeSourceFingerprint('source-new') — printed by
 * dry-run-new.ts. Fingerprint is scoped to source-new/ only, independent
 * of the original batch's source/ fingerprint, so approving one batch
 * never approves the other.
 *
 * Usage:
 *   npx tsx scripts/historical-import/apply-new.ts --apply --confirm-production <token>
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { loadDailyFacts } from './lib/daily-facts.js';
import { loadAprilSchedule } from './lib/schedule-index.js';
import { loadAprilSchedulePlan } from './lib/schedules-import.js';
import { resolveStore, type StoreResolution } from './lib/resolve-store.js';
import { findNewBatchOverride } from './lib/overrides-new.js';
import { computeSourceFingerprint } from './lib/fingerprint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, 'source-new');
const src = (name: string) => readFileSync(path.join(sourceDir, name), 'utf8');

const DATE_FROM = '2025-11-01';
const DATE_TO = '2026-03-31';
const NEW_HISTORICAL_EMPLOYEES_TO_CREATE: readonly string[] = [
  'Вурсол Павел Алексеевич',
  'Петрова Екатерина Андреевна',
  'Самохина Ольга Васильевна',
];

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
    console.log('Expected --confirm-production token for the current source-new bundle:', expectedToken);
    process.exit(1);
  }
  if (confirmToken !== expectedToken) {
    console.error('Refusing to run: --confirm-production token missing or does not match the current source-new bundle fingerprint.');
    console.error('Expected:', expectedToken, ' got:', confirmToken ?? '(none)');
    console.error('Run dry-run-new.ts first and copy the printed token exactly — this proves you reviewed THIS exact data.');
    process.exit(1);
  }

  let url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  if (url.includes('railway') && !/[?&]sslmode=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'sslmode=no-verify';
    process.env.DATABASE_URL = url;
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('railway') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  // Loaded dynamically, after DATABASE_URL is normalized above — see the
  // identical comment in apply.ts for why this must not be a static import.
  const { applyNewHistoricalImportBatch } = await import('./lib/apply-engine-new.js');

  try {
    const dailyFacts = loadDailyFacts(src('t2_new_daily_facts.csv'));
    const scheduleIdx = loadAprilSchedule(src('t2_new_schedules.csv'));
    const schedulePlanRows = loadAprilSchedulePlan(src('t2_new_schedules.csv'));
    const resolutions = dailyFacts.map((f) => resolveStoreNew(f.employeeName, f.date, scheduleIdx));

    const conflicts = resolutions.filter((r) => r.category === 'NO_STORE_NO_SCHEDULE' || r.category === 'NO_STORE_DAY_OFF_CONFLICT');
    if (conflicts.length > 0) {
      throw new Error(`Refusing to apply: ${conflicts.length} unresolved NO_STORE/CONFLICT rows remain. Run dry-run-new.ts and resolve first.`);
    }

    // org_id derived only from the employees THIS dataset actually
    // matches (6 of 9 names) — must agree with dry-run-new.ts's identical
    // derivation, or the dry-run report's "would create under org_id=X"
    // could silently diverge from what apply actually does.
    const employeeNames = [...new Set(dailyFacts.map((f) => f.employeeName))];
    const empRes = await client.query('SELECT full_name, org_id FROM employees');
    const matchedOrgIds = new Set(
      empRes.rows.filter((r: any) => employeeNames.includes(r.full_name)).map((r: any) => r.org_id)
    );
    if (matchedOrgIds.size !== 1) {
      throw new Error(
        `Refusing to guess org_id for new historical employees: the existing employees this dataset matches span ${matchedOrgIds.size} distinct org_id values (${[...matchedOrgIds].join(', ')}).`
      );
    }
    const orgId = [...matchedOrgIds][0] as string;

    const batchId = `historical-import-new-${randomUUID()}`;
    console.log('Applying batch', batchId, 'orgId', orgId, 'range', DATE_FROM, '..', DATE_TO);

    const counts = await applyNewHistoricalImportBatch(
      { dailyFacts, resolutions, schedulePlanRows },
      batchId,
      orgId,
      NEW_HISTORICAL_EMPLOYEES_TO_CREATE,
      DATE_FROM,
      DATE_TO
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
