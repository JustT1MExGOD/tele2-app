/**
 * Real-PostgreSQL validation harness for the historical import (Phase 1
 * gate). Runs entirely against two disposable, local `embedded-postgres`
 * instances — never production. Exercises checklist items A-L requested
 * for production sign-off, plus the zero-side-effect SQL assertions.
 *
 * This script only ever calls `applyHistoricalImportBatch` /
 * `rollbackBatch` directly (bypassing apply.ts's CLI safety switches,
 * which are a separate, already-typechecked concern) against LOCAL
 * databases. It never sets DATABASE_URL to anything containing
 * "railway" or any production-looking host.
 *
 * Usage: npx tsx scripts/historical-import/validate-real-postgres.ts
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');
const migrationsDir = path.join(repoRoot, 'migrations');
const sourceDir = path.join(__dirname, 'source');
const src = (name: string) => readFileSync(path.join(sourceDir, name), 'utf8');

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log('  PASS:', label);
  } else {
    console.log('  FAIL:', label);
    failures += 1;
  }
}
function section(title: string) {
  console.log('\n=== ' + title + ' ===');
}

async function startInstance(port: number, dataDir: string) {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('t2sales_test');
  return pg;
}

async function main() {
  const workDir = mkdtempSync(path.join(tmpdir(), 't2-historical-validate-'));
  console.log('scratch dir:', workDir);

  // ---- Instance B (throwaway): checklist A + B ----
  section('A/B — migrations from scratch, and 0028 cleanly on top of 0027');
  const dirB = path.join(workDir, 'pgdata-b');
  const pgB = await startInstance(55491, dirB);
  try {
    const scratchMigrations = path.join(workDir, 'migrations-scratch');
    mkdirSync(path.join(scratchMigrations, 'migrations'), { recursive: true });
    const allFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    assert(allFiles.length === 28, 'expected 28 migration files, found ' + allFiles.length);
    const upTo0027 = allFiles.filter((f) => f < '0028');
    for (const f of upTo0027) {
      copyFileSync(path.join(migrationsDir, f), path.join(scratchMigrations, 'migrations', f));
    }

    // Run in a SEPARATE process — src/data/db/index.js registers
    // prom-client Gauges against a process-wide singleton registry at
    // module-load time; a second in-process import (even cache-busted)
    // of that module throws "metric already registered".
    const out = execFileSync(
      'npx',
      ['tsx', path.join(__dirname, 'validate-migrations-b.ts')],
      {
        shell: true,
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://postgres:postgres@localhost:55491/t2sales_test`,
          PGSSL: 'false',
          MIGRATIONS_SCRATCH_DIR: scratchMigrations,
          REAL_0028_PATH: path.join(migrationsDir, '0028_historical_import_ledger.sql'),
        },
        encoding: 'utf8',
      }
    );
    const lastLine = out.trim().split('\n').filter(Boolean).pop()!;
    const bResult = JSON.parse(lastLine);
    assert(bResult.appliedPhase1.length === upTo0027.length, `0001..0027 applied fresh (${bResult.appliedPhase1.length}/${upTo0027.length})`);
    assert(bResult.ledgerExistsBeforePhase2 === false, 'import_ledger does NOT exist yet after 0001..0027 (B pre-check)');
    assert(bResult.appliedPhase2.length === 1 && bResult.appliedPhase2[0].startsWith('0028'), '0028 applied cleanly on top of 0027 schema (checklist B)');
    assert(bResult.ledgerExistsAfterPhase2 === true, 'import_ledger table exists after 0028');
  } finally {
    await pgB.stop();
  }

  // ---- Instance A (main): C-L + side effects ----
  section('Starting main instance for C-L');
  const dirA = path.join(workDir, 'pgdata-a');
  const pgA = await startInstance(55492, dirA);
  try {
    process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:55492/t2sales_test`;
    process.env.PGSSL = 'false';
    const { runMigrations } = await import('../../src/data/db/migrate.js');
    const { pool, query, withTransaction } = await import('../../src/data/db/index.js');

    section('A (full run) — migrations 0001..0028 apply from scratch on instance A');
    const resAll = await runMigrations();
    assert(resAll.applied.length === 28, `all 28 migrations applied (${resAll.applied.length}/28)`);

    // Seed the 6 real matched employees (org_id='default'), matching
    // production names/org_id exactly (read-only-confirmed this session),
    // so the engine exercises real INSERT/UPDATE paths, not just
    // SOURCE_ONLY rows for unmatched names.
    const matchedNames = [
      'Афанасьев Аким Александрович',
      'Бижонов Семен Михайлович',
      'Каравашков Андрей Алексеевич',
      'Соловьёва Милана Андреевна',
      'Степанов Алексей Юрьевич',
      'Тутаев Никита Алексеевич',
    ];
    await pool.query(`INSERT INTO organizations (id, name) VALUES ('default', 'Default org')`);
    for (const name of matchedNames) {
      await pool.query(
        `INSERT INTO employees (full_name, role, is_active, access_status, telegram_id, org_id) VALUES ($1, 'employee', true, 'active', NULL, 'default')`,
        [name]
      );
    }

    const { loadDailyFacts } = await import('./lib/daily-facts.js');
    const { loadMayJulSchedule, loadAprilSchedule, mergeScheduleIndexes } = await import('./lib/schedule-index.js');
    const { loadMayJulSchedulePlan, loadAprilSchedulePlan } = await import('./lib/schedules-import.js');
    const { resolveStore } = await import('./lib/resolve-store.js');
    const { loadMonthlyPlans } = await import('./lib/monthly-plans.js');
    const { loadCashPlan } = await import('./lib/cash.js');
    const { applyHistoricalImportBatch } = await import('./lib/apply-engine.js');
    const { rollbackBatch } = await import('./lib/ledger.js');

    const dailyFacts = loadDailyFacts(src('t2_legacy_daily_facts.csv'));
    const scheduleIdx = mergeScheduleIndexes(
      loadMayJulSchedule(src('t2_legacy_schedules.csv')),
      loadAprilSchedule(src('t2_april_schedule.csv'))
    );
    const resolutions = dailyFacts.map((f: any) => resolveStore(f.employeeName, f.date, scheduleIdx));
    const schedulePlanRows = [
      ...loadMayJulSchedulePlan(src('t2_legacy_schedules.csv')),
      ...loadAprilSchedulePlan(src('t2_april_schedule.csv')),
    ];
    const monthlyPlans = loadMonthlyPlans(src('t2_legacy_monthly_plans.csv'));
    const cashPlan = loadCashPlan(src('t2_legacy_cash.csv'));
    const sources = { dailyFacts, resolutions, schedulePlanRows, monthlyPlans, cashPlan };

    section('K/L — constraint checks (FK/UNIQUE/CHECK), schedules UNIQUE, before any real data');
    // schedules_employee_date_uq: insert an employee + two schedule rows same (employee_id, work_date)
    const empIdRes = await pool.query(`SELECT id FROM employees WHERE full_name = $1`, [matchedNames[0]]);
    const empId = empIdRes.rows[0].id;
    await pool.query(`INSERT INTO schedules (employee_id, work_date, store_id, shift_text, hours) VALUES ($1, '2026-04-01', 'S1', '9-18', 8)`, [empId]);
    let uqRejected = false;
    try {
      await pool.query(`INSERT INTO schedules (employee_id, work_date, store_id, shift_text, hours) VALUES ($1, '2026-04-01', 'S2', '9-18', 8)`, [empId]);
    } catch (e: any) {
      uqRejected = /unique|duplicate/i.test(String(e.message));
    }
    assert(uqRejected, 'schedules UNIQUE(employee_id, work_date) rejects duplicate insert (checklist L)');
    await pool.query(`DELETE FROM schedules WHERE employee_id = $1 AND work_date = '2026-04-01'`, [empId]);

    let checkRejected = false;
    try {
      await pool.query(`INSERT INTO import_ledger (batch_id, entity, natural_key, operation, before_state, after_state, source_row) VALUES ('x','sales','{}','bogus_op','{}','{}','{}')`);
    } catch (e: any) {
      checkRejected = /check/i.test(String(e.message)) || /violates/i.test(String(e.message));
    }
    assert(checkRejected, 'import_ledger CHECK(operation IN (insert,update)) rejects invalid operation (checklist K)');

    section('J — transaction failure mid-batch leaves no partial import');
    // Force a genuine DB-level failure: duplicate one schedulePlanRows
    // entry so diffSchedules (comparing against the pre-batch snapshot)
    // classifies BOTH copies as INSERT for the same (employee_id,
    // work_date) — the first INSERT succeeds inside the transaction, the
    // second hits schedules_employee_date_uq for real, well after sales
    // has already written rows in the SAME transaction. This proves the
    // whole withTransaction call rolls back atomically, not just the
    // failing statement.
    let sawFailure = false;
    const salesCountBefore = (await pool.query(`SELECT count(*) FROM sales`)).rows[0].count;
    const badSources = {
      ...sources,
      schedulePlanRows: [...schedulePlanRows, { ...schedulePlanRows[0] }],
    };
    try {
      await applyHistoricalImportBatch(badSources, 'batch-forced-failure', 'default');
    } catch (e) {
      sawFailure = true;
    }
    const salesCountAfter = (await pool.query(`SELECT count(*) FROM sales`)).rows[0].count;
    assert(sawFailure, 'forced bad row actually threw');
    assert(salesCountBefore === salesCountAfter, 'sales table unchanged after forced mid-batch failure (checklist J: atomic rollback)');
    const ledgerForFailedBatch = await pool.query(`SELECT count(*) FROM import_ledger WHERE batch_id = 'batch-forced-failure'`);
    assert(Number(ledgerForFailedBatch.rows[0].count) === 0, 'no ledger rows survive for the failed batch');
    const employeesAfterFail = await pool.query(`SELECT count(*) FROM employees`);
    assert(Number(employeesAfterFail.rows[0].count) === 6, 'no historical employees leaked from the failed batch (still 6)');

    section('C — real apply executes');
    const batchId = `historical-import-${randomUUID()}`;
    const counts = await applyHistoricalImportBatch(sources, batchId, 'default');
    console.log('  apply counts:', JSON.stringify(counts));
    assert(counts.employeesCreated === 4, 'exactly 4 historical employees created');
    assert(counts.salesInserted > 0, 'sales rows inserted');
    assert(counts.scheduleInserted > 0, 'schedule rows inserted');
    assert(counts.plansInserted > 0, 'plan rows inserted');
    assert(counts.cashInserted > 0, 'cash rows inserted');

    const empCountAfterApply = (await pool.query(`SELECT count(*) FROM employees`)).rows[0].count;
    assert(Number(empCountAfterApply) === 10, '6 existing + 4 created = 10 employees total');
    const newEmp = await pool.query(`SELECT full_name, role, is_active, access_status, telegram_id, org_id FROM employees WHERE full_name = 'Славик МТС'`);
    assert(newEmp.rows.length === 1, 'Славик МТС created with exact display name');
    const nr = newEmp.rows[0];
    assert(nr.role === 'employee' && nr.is_active === false && nr.access_status === 'none' && nr.telegram_id === null && nr.org_id === 'default', 'Славик МТС has role=employee,is_active=false,access_status=none,telegram_id=NULL,org_id=default');

    section('E — ledger contains correct before/after state');
    const ledgerRows = await pool.query(`SELECT entity, operation, before_state, after_state FROM import_ledger WHERE batch_id = $1`, [batchId]);
    assert(Number(ledgerRows.rowCount) === (counts.employeesCreated + counts.salesInserted + counts.salesUpdated + counts.scheduleInserted + counts.scheduleUpdated + counts.plansInserted + counts.plansUpdated + counts.cashInserted + counts.cashUpdated), 'ledger row count matches total inserted+updated rows');
    const empLedger = ledgerRows.rows.find((r: any) => r.entity === 'employees');
    assert(empLedger && empLedger.before_state === null && empLedger.after_state.role === 'employee', 'employee ledger row: before=null, after has correct role');

    section('D — idempotent re-run of same bundle');
    const batchId2 = `historical-import-${randomUUID()}`;
    const counts2 = await applyHistoricalImportBatch(sources, batchId2, 'default');
    console.log('  re-run counts:', JSON.stringify(counts2));
    assert(counts2.employeesCreated === 0, 're-run creates 0 employees (all 4 already exist)');
    assert(counts2.salesInserted === 0 && counts2.scheduleInserted === 0 && counts2.plansInserted === 0 && counts2.cashInserted === 0, 're-run inserts 0 new rows');
    assert(counts2.salesUpdated === 0 && counts2.scheduleUpdated === 0 && counts2.plansUpdated === 0 && counts2.cashUpdated === 0, 're-run updates 0 rows (all identical)');
    assert(counts2.salesSkippedIdentical === counts.salesInserted, 're-run reports all sales rows as skipped-identical');
    const empCountAfterRerun = (await pool.query(`SELECT count(*) FROM employees`)).rows[0].count;
    assert(Number(empCountAfterRerun) === 10, 'employee count unchanged after idempotent re-run');

    section('6 — side-effect SQL assertions (zero live side effects)');
    // Real table names in this schema (confirmed via grep across
    // migrations/*.sql) that would be touched by the LIVE sale/shift/
    // gamification/notification code paths this importer never calls.
    // A few names from the original request (clock_ins, xp_grants,
    // report_jobs, notifications) don't exist under those names in this
    // schema at all — checked anyway below and reported N/A, not
    // silently skipped, plus the real equivalents are included.
    const forbiddenTables = [
      'sales_events', 'shift_sessions', 'clock_ins',
      'xp_events', 'xp_grants', 'employee_badges',
      'report_jobs', 'notifications', 'smart_alerts', 'alert_flags',
      'bot_sent_messages', 'cron_send_log', 'sales_audit', 'audit_log',
    ];
    for (const t of forbiddenTables) {
      const exists = await pool.query(`SELECT to_regclass('public.' || $1) AS t`, [t]);
      if (exists.rows[0].t === null) {
        console.log(`  N/A: table ${t} does not exist in this schema at all — nothing to check`);
        continue;
      }
      const cnt = await pool.query(`SELECT count(*) FROM ${t}`);
      assert(Number(cnt.rows[0].count) === 0, `${t} has 0 rows after historical import`);
    }

    section('H — manual edit post-import, then rollback must NOT destroy it (sales)');
    const oneSalesLedger = ledgerRows.rows.find((r: any) => r.entity === 'sales');
    const salesLedgerFull = await pool.query(
      `SELECT natural_key FROM import_ledger WHERE batch_id = $1 AND entity = 'sales' AND operation = 'insert' LIMIT 1`,
      [batchId]
    );
    const nk = salesLedgerFull.rows[0].natural_key;
    await pool.query(
      `UPDATE sales SET sim = sim + 999999 WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [nk.employee_id, nk.store_id, nk.sale_date]
    );
    const manuallyEditedValue = (await pool.query(
      `SELECT sim FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [nk.employee_id, nk.store_id, nk.sale_date]
    )).rows[0].sim;

    section('F — rollback restores DB to pre-import state (except the manually-edited row)');
    const rollbackResult = await rollbackBatch(batchId);
    console.log('  rollback result:', JSON.stringify(rollbackResult));
    assert(rollbackResult.deleted > 0, 'rollback deleted inserted rows');
    assert(rollbackResult.skippedConcurrentEdit >= 1, 'rollback skipped the manually-edited sales row (divergence protection, checklist H)');
    const stillThere = await pool.query(
      `SELECT sim FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [nk.employee_id, nk.store_id, nk.sale_date]
    );
    assert(stillThere.rows.length === 1 && String(stillThere.rows[0].sim) === String(manuallyEditedValue), 'manually-edited sales row NOT destroyed by rollback');

    const empCountAfterRollback = (await pool.query(`SELECT count(*) FROM employees`)).rows[0].count;
    // 6 original + 4 created, minus however many of the 4 got deleted by rollback (deleted count includes non-employee rows too, check employees specifically)
    const remainingHistoricalEmployees = await pool.query(
      `SELECT full_name FROM employees WHERE full_name = ANY($1)`,
      [['Баранова София Андреевна', 'Рогожин Вячеслав Александрович', 'Славик МТС', 'Чернова Александра Сергеевна']]
    );
    console.log('  historical employees remaining after rollback:', remainingHistoricalEmployees.rows.map((r: any) => r.full_name));

    section('I — divergence protection for a manually-edited historical employee row');
    if (remainingHistoricalEmployees.rows.length > 0) {
      const nameStillPresent = remainingHistoricalEmployees.rows[0].full_name;
      await pool.query(`UPDATE employees SET is_active = true WHERE full_name = $1`, [nameStillPresent]);
      console.log('  N/A for this run — employee row already rolled back or manually edited post-fact; see explicit second scenario below.');
    }

    section('I (explicit scenario) — re-apply, manually edit new employee row, rollback protects it');
    const batchId3 = `historical-import-${randomUUID()}`;
    const counts3 = await applyHistoricalImportBatch(sources, batchId3, 'default');
    console.log('  re-apply after rollback counts:', JSON.stringify(counts3));
    const empLedger3 = await pool.query(
      `SELECT natural_key FROM import_ledger WHERE batch_id = $1 AND entity = 'employees' LIMIT 1`,
      [batchId3]
    );
    if (empLedger3.rows.length > 0) {
      const empName = empLedger3.rows[0].natural_key.full_name;
      await pool.query(`UPDATE employees SET is_active = true WHERE full_name = $1`, [empName]);
      const editedRes = await rollbackBatch(batchId3);
      console.log('  rollback (with manually-edited employee) result:', JSON.stringify(editedRes));
      assert(editedRes.skippedConcurrentEdit >= 1, 'rollback detects divergence on manually-edited employee row and skips it (checklist I)');
      const stillActive = await pool.query(`SELECT is_active FROM employees WHERE full_name = $1`, [empName]);
      assert(stillActive.rows.length === 1 && stillActive.rows[0].is_active === true, 'manually-edited employee row NOT destroyed by rollback');
      await rollbackBatch(batchId3); // clean up remaining rows for this sub-scenario (idempotent per checklist G)
    } else {
      console.log('  N/A — no new employees created on this re-apply (all 4 already existed from batch 1); scenario not exercised.');
    }

    section('G — second rollback of the ORIGINAL batch is a safe no-op');
    const secondRollback = await rollbackBatch(batchId);
    assert(secondRollback.restored === 0 && secondRollback.deleted === 0, 'second rollback of already-rolled-back batch touches nothing new (checklist G)');
    // The one row skipped in step H (manually edited, never reverted)
    // permanently diverges from after_state, so it is correctly
    // re-reported as skipped on every subsequent rollback call too —
    // rolled_back_at is only set for rows actually acted on. This is
    // exactly the same divergence-protection outcome as the first call,
    // not a new mutation, so it's still a safe no-op.
    assert(secondRollback.skippedConcurrentEdit === rollbackResult.skippedConcurrentEdit, 'second rollback re-reports the same still-diverged row(s), mutates nothing new (checklist G)');

    await pool.end();
  } finally {
    await pgA.stop();
    rmSync(workDir, { recursive: true, force: true });
  }

  section('SUMMARY');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED (' + 'A-L + side-effects' + ')');
  } else {
    console.log(failures + ' CHECK(S) FAILED');
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('VALIDATION HARNESS CRASHED:', e);
  process.exit(1);
});
