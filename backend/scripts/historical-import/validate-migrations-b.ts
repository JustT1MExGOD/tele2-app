/**
 * Checklist A/B helper, run as its OWN process (not imported into
 * validate-real-postgres.ts's process) specifically because
 * src/data/db/index.ts registers prom-client Gauges at module-load time
 * against a process-wide singleton registry — a second in-process import
 * of that module (even via a cache-busted dynamic import) throws
 * "metric already registered". A separate process sidesteps this
 * cleanly instead of reaching into prom-client's registry API.
 *
 * Expects env: DATABASE_URL, PGSSL=false, MIGRATIONS_SCRATCH_DIR (a
 * directory containing a migrations/ subfolder with ONLY 0001..0027),
 * and REAL_0028_PATH (path to the real 0028 migration file to copy in
 * for the second phase).
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const scratchDir = process.env.MIGRATIONS_SCRATCH_DIR!;
  const real0028 = process.env.REAL_0028_PATH!;
  process.chdir(scratchDir);

  const { runMigrations } = await import('../../src/data/db/migrate.js');
  const { pool } = await import('../../src/data/db/index.js');

  const res1 = await runMigrations();
  const ledgerBefore = await pool.query(`SELECT to_regclass('public.import_ledger') AS t`);

  mkdirSync(path.join(scratchDir, 'migrations'), { recursive: true });
  copyFileSync(real0028, path.join(scratchDir, 'migrations', path.basename(real0028)));
  const res2 = await runMigrations();
  const ledgerAfter = await pool.query(`SELECT to_regclass('public.import_ledger') AS t`);

  await pool.end();
  console.log(JSON.stringify({
    appliedPhase1: res1.applied,
    ledgerExistsBeforePhase2: ledgerBefore.rows[0].t !== null,
    appliedPhase2: res2.applied,
    ledgerExistsAfterPhase2: ledgerAfter.rows[0].t !== null,
  }));
}

main().catch((e) => {
  console.error('B-CHECK FAILED:', e);
  process.exit(1);
});
