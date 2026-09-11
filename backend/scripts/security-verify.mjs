#!/usr/bin/env node
/**
 * 17-layer security hardening pass, new Layer 16 (Continuous Security
 * Verification) — a single command aggregating the checks that actually
 * gate a PR on security grounds. Deliberately NOT a re-run of the whole
 * test suite (that's `npm test`/`npm run test:frontend`, already its own
 * CI step) — this is specifically the fast, security-relevant static
 * checks, so `npm run security:verify` is meaningful to run locally
 * before every push without waiting on the full (minutes-long) test run.
 *
 * Split explicitly requested by the hardening brief: FAST PR GATE (this
 * script) vs HEAVIER SECURITY TESTS (CodeQL's scheduled deep scan, see
 * .github/workflows/codeql.yml) — this file only runs things that
 * complete in seconds and need no external service/API key.
 *
 * Each check is a pre-existing, independently-runnable npm script — this
 * file doesn't duplicate their logic, only sequences them and gives one
 * pass/fail summary. A check failing here doesn't stop the next one from
 * running (developer wants the FULL list of what's currently broken in
 * one pass, not a game of whack-a-mole one failure at a time) — the
 * overall command still exits non-zero if anything failed.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CHECKS = [
  // Layer 3 (RBAC) — every route guarded or explicitly, reviewably public.
  { name: 'route-auth', script: 'check-route-auth-policy.mjs' },
  // Layer 5 (Data Access) — data/repositories/* stays the only path to Postgres.
  { name: 'no-direct-sql', script: 'check-no-direct-sql.mjs' },
  // Layer 9 (Веб-интерфейс) — the 4 most dangerous JS sinks stay at zero.
  { name: 'dangerous-js', script: 'check-dangerous-js-patterns.mjs' },
  // Layer 9 — inline onclick=/onchange=/oninput=/onsubmit= regression ratchet.
  { name: 'inline-event-handlers', script: 'check-inline-event-handlers.mjs' },
  // Layer 14 (Secrets) — fast local pre-check; CI also runs real gitleaks
  // over full git history (see .github/workflows/ci.yml), which this
  // working-tree-only scan doesn't replace.
  { name: 'secrets', script: 'check-secrets.mjs' },
  // Module boundary discipline — a compromised/careless module importing
  // across a boundary it shouldn't is itself a security-relevant class of
  // bug (widens what one bug in one module can reach), not just a style
  // preference — that's why it's in the security gate, not only in CI's
  // general lint step.
  { name: 'architecture', script: 'check-architecture-boundaries.mjs' },
  { name: 'circular-deps', script: 'check-circular-deps.mjs' }
];

let anyFailed = false;
const results = [];

// Every check above is a plain `node scripts/<file>.mjs` — invoked via
// the current Node binary directly (process.execPath), never through
// `npm run`/a shell, so there's no cross-platform npm.cmd-vs-npm
// resolution to get wrong and nothing here needs `shell: true` (which
// Node's own spawnSync docs flag as an argument-escaping risk when args
// are passed as an array) — the args below are always hardcoded, never
// built from external input, but this script IS the security tooling and
// shouldn't model a pattern it would otherwise want flagged.
for (const check of CHECKS) {
  const scriptPath = path.join(ROOT, 'scripts', check.script);
  const label = check.name.padEnd(24, ' ');
  process.stdout.write(`\n▶ ${label} (node scripts/${check.script})\n`);
  const res = spawnSync(process.execPath, [scriptPath], { cwd: ROOT, stdio: 'inherit' });
  const ok = res.status === 0;
  if (!ok) anyFailed = true;
  results.push({ name: check.name, ok });
}

// Dependency vulnerability policy — the one check here that genuinely
// needs the npm binary (audit isn't a standalone script), so it's kept
// separate from the loop above and uses a single command STRING with
// `shell: true` (not an args array) — no argument-escaping surface since
// there's nothing to escape into a string with fixed content.
{
  process.stdout.write(`\n▶ ${'npm-audit'.padEnd(24, ' ')} (npm audit --audit-level=high)\n`);
  const res = spawnSync('npm audit --audit-level=high', { cwd: ROOT, stdio: 'inherit', shell: true });
  const ok = res.status === 0;
  if (!ok) anyFailed = true;
  results.push({ name: 'npm-audit', ok });
}

console.log('\n' + '='.repeat(50));
console.log('security:verify summary');
console.log('='.repeat(50));
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}`);
}
console.log('='.repeat(50));

if (anyFailed) {
  console.error('\n❌ security:verify — one or more checks failed, see above.');
  process.exit(1);
}
console.log('\n✅ security:verify — all checks passed.');
