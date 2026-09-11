/**
 * 17-layer security hardening pass, new Layer 17 (Resilience / Recovery)
 * — safe tooling for docs/RUNBOOK.md's "Компрометация пароля/сессии
 * сотрудника" procedure, which previously only documented raw SQL
 * (`DELETE FROM employee_sessions WHERE employee_id = <ID>` etc.) run by
 * hand against the Railway Postgres console. This script wraps the exact
 * same repository functions the real API routes already use for the
 * same containment actions (PATCH /employees/:id/role's session-
 * revocation-on-escalation, POST /employees/:id/mfa/reset, DELETE
 * /employees/:id) — not a parallel, unaudited path to the data.
 *
 * DRY-RUN BY DEFAULT — prints exactly what it would do and changes
 * nothing, unless --confirm is passed explicitly. Never destructive by
 * accident; matches this repo's CLAUDE.md discipline (direct prod writes
 * outside migrations require explicit owner confirmation) — this script
 * doesn't bypass that, it's a clearly-scoped, reviewable alternative to
 * an ad-hoc SQL statement typed by hand mid-incident, which is easy to
 * get subtly wrong under pressure (wrong id, forgot a WHERE clause).
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/contain-compromised-employee.ts --employee-id=123 [--sessions] [--mfa] [--deactivate] [--confirm]
 *
 * Actions (each opt-in via its own flag, so a real incident only touches
 * exactly what's needed — see RUNBOOK.md's own per-scenario guidance for
 * which combination fits which situation):
 *   --sessions     revoke all active browser sessions (sessionsRepo.deleteAllForEmployee)
 *   --mfa          revoke all Telegram AAL2 grants (mfaRepo.revokeAllTelegramGrants) —
 *                  does NOT delete TOTP/WebAuthn/recovery-code enrollment itself;
 *                  that's POST /employees/:id/mfa/reset in the running app (needs
 *                  a second admin's step-up-gated action by design, not a CLI bypass)
 *   --deactivate   set is_active=false (employeesRepo.softDeactivate) — the most
 *                  severe option, blocks ALL access including re-login
 *
 * At least one action flag is required — running with none is refused
 * (nothing to confirm), not silently a no-op.
 */
import '../env.js'; // must be first — see env.ts's own header comment
import { pathToFileURL } from 'url';
import * as sessionsRepo from '../data/repositories/sessions.js';
import * as mfaRepo from '../data/repositories/mfa.js';
import * as employeesRepo from '../data/repositories/employees.js';
import { query } from '../data/db/index.js';

export interface ContainOptions {
  employeeId: number;
  sessions?: boolean;
  mfa?: boolean;
  deactivate?: boolean;
  confirm?: boolean;
}

export interface ContainResult {
  found: boolean;
  target?: { id: number; full_name: string; role: string; org_id: string | null; is_active: boolean };
  activeSessions?: number;
  activeTelegramGrants?: number;
  applied: { sessions: boolean; mfa: boolean; deactivate: boolean };
  dryRun: boolean;
}

/** No process.exit()/console output here — see backfill-support-encryption.ts
 * for the same "core logic is a plain testable function, CLI framing is
 * separate" split this mirrors. Returns a structured result so both the
 * CLI wrapper below and tests can inspect exactly what happened/would happen. */
export async function containEmployee(opts: ContainOptions): Promise<ContainResult> {
  const { employeeId, sessions = false, mfa = false, deactivate = false, confirm = false } = opts;

  const emp = await query(`SELECT id, full_name, role, org_id, is_active FROM employees WHERE id = $1`, [employeeId]);
  if (!emp.rows[0]) {
    return { found: false, applied: { sessions: false, mfa: false, deactivate: false }, dryRun: !confirm };
  }
  const target = emp.rows[0];

  const activeSessionsRes = await query(`SELECT COUNT(*)::int AS c FROM employee_sessions WHERE employee_id = $1`, [employeeId]);
  const telegramGrantsRes = await query(`SELECT COUNT(*)::int AS c FROM mfa_telegram_grants WHERE employee_id = $1`, [employeeId]);

  if (!confirm) {
    return {
      found: true,
      target,
      activeSessions: activeSessionsRes.rows[0].c,
      activeTelegramGrants: telegramGrantsRes.rows[0].c,
      applied: { sessions: false, mfa: false, deactivate: false },
      dryRun: true
    };
  }

  if (sessions) await sessionsRepo.deleteAllForEmployee(employeeId);
  if (mfa) await mfaRepo.revokeAllTelegramGrants(employeeId);
  if (deactivate) await employeesRepo.softDeactivate(employeeId);

  return {
    found: true,
    target,
    activeSessions: activeSessionsRes.rows[0].c,
    activeTelegramGrants: telegramGrantsRes.rows[0].c,
    applied: { sessions, mfa, deactivate },
    dryRun: false
  };
}

function parseArgs(): ContainOptions & { hasAnyAction: boolean } {
  const args = process.argv.slice(2);
  const employeeIdArg = args.find((a) => a.startsWith('--employee-id='));
  const employeeId = employeeIdArg ? Number(employeeIdArg.split('=')[1]) : NaN;
  const sessions = args.includes('--sessions');
  const mfa = args.includes('--mfa');
  const deactivate = args.includes('--deactivate');
  return { employeeId, sessions, mfa, deactivate, confirm: args.includes('--confirm'), hasAnyAction: sessions || mfa || deactivate };
}

async function main() {
  const { employeeId, sessions, mfa, deactivate, confirm, hasAnyAction } = parseArgs();

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    console.error('Usage: npx tsx src/scripts/contain-compromised-employee.ts --employee-id=<id> [--sessions] [--mfa] [--deactivate] [--confirm]');
    process.exit(1);
  }
  if (!hasAnyAction) {
    console.error('No action flag given (--sessions / --mfa / --deactivate) — nothing to do. Refusing to run as a silent no-op.');
    process.exit(1);
  }

  const result = await containEmployee({ employeeId, sessions, mfa, deactivate, confirm });
  if (!result.found) {
    console.error(`No employee with id=${employeeId} found.`);
    process.exit(1);
  }

  const t = result.target!;
  console.log(`Target: #${t.id} "${t.full_name}" — role=${t.role} org=${t.org_id} is_active=${t.is_active}`);
  console.log('\nPlanned actions:');
  if (sessions) console.log(`  [sessions]    revoke ${result.activeSessions} active browser session(s)`);
  if (mfa) console.log(`  [mfa]         revoke ${result.activeTelegramGrants} active Telegram AAL2 grant(s) (enrollment itself untouched)`);
  if (deactivate) console.log(`  [deactivate]  set is_active = false (blocks ALL access, including re-login)`);

  if (result.dryRun) {
    console.log('\nDRY RUN — nothing changed. Re-run with --confirm to actually apply the actions above.');
    process.exit(0);
  }

  console.log('\n--confirm passed — applied.');
  if (result.applied.sessions) console.log('  ✅ sessions revoked');
  if (result.applied.mfa) console.log('  ✅ Telegram AAL2 grants revoked');
  if (result.applied.deactivate) console.log('  ✅ employee deactivated');
  console.log(`\nDone. Verify via: SELECT * FROM audit_log WHERE target_id='${employeeId}' ORDER BY created_at DESC LIMIT 10;`);
  process.exit(0);
}

// Guarded so tests can import containEmployee() directly without
// triggering a full CLI run (which would process.exit()) — same pattern
// as backfill-support-encryption.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('contain-compromised-employee failed:', e?.message || e);
    process.exit(1);
  });
}
