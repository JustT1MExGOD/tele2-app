#!/usr/bin/env node
/**
 * 17-layer security hardening pass, new Layer 14 (Secrets & Key
 * Lifecycle) — lightweight, dependency-free local secret scanner, run as
 * part of `npm run security:verify` before every push. This is NOT a
 * replacement for real secret-scanning in CI (see .github/workflows/
 * ci.yml's gitleaks step, which scans full git history with a
 * well-maintained, purpose-built tool) — this is a fast, zero-dependency
 * pre-check over the CURRENT working tree only, same "small grep,
 * explicit failure policy" model as check-dangerous-js-patterns.mjs and
 * check-no-direct-sql.mjs, so `security:verify` has something to run
 * without requiring gitleaks installed locally.
 *
 * Scans TRACKED files only (`git ls-files`) — never node_modules, dist,
 * or untracked scratch files — for patterns shaped like a real committed
 * credential: AWS access keys, private-key PEM blocks, and a long
 * high-entropy string literal assigned to a SECRET/TOKEN/KEY/PASSWORD-
 * shaped variable name. Deliberately does NOT flag bare references to
 * secret env-var NAMES (`process.env.BOT_TOKEN`, `BOT_TOKEN=` in a
 * .env.example-style template, docs mentioning "DATABASE_URL") — this
 * codebase's convention (SECURITY.md's Baseline Rule #5) is that env var
 * names appear everywhere in code/docs/tests, only ASSIGNED VALUES that
 * look like real secret material are the actual finding.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const FINDINGS = [];

const PATTERNS = [
  { name: 'AWS access key ID', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'PEM private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'high-entropy value assigned to a secret-shaped variable',
    // e.g. BOT_TOKEN="123456:AAExampleRealLookingTokenBytesHere1234", not
    // BOT_TOKEN= (empty template) or process.env.BOT_TOKEN (a reference).
    pattern: /\b(?:SECRET|TOKEN|API_KEY|PASSWORD|PRIVATE_KEY|BOT_TOKEN|DATABASE_URL)\s*[:=]\s*['"][A-Za-z0-9+/_\-.:]{20,}['"]/
  }
];

// Known-safe: deterministic test-only material, never real credentials —
// same values tests/setup.ts itself uses (Buffer.alloc(32,7) etc.), plus
// this script's own pattern definitions, which necessarily contain the
// word "SECRET"/"TOKEN" as string literals without being one.
const ALLOWLIST_SUBSTRINGS = [
  'scripts/check-secrets.mjs', // this file itself — the PATTERNS array above would self-match
  // Deliberately fake string, not a real token — asserts the auth-bypass
  // regression stays closed even with a BOT_TOKEN env var present.
  'tests/adversarial/auth-bypass-unverified-header.test.ts',
  // Test-only TLS key pairs (relay/desktop test suites exercise real
  // certificate validation/rejection — "untrusted-key.pem" is deliberately
  // an untrusted/self-signed key used to prove rejection works) — never
  // used for anything but local test fixtures, not production material.
  'desktop/tests/fixtures/test-key.pem',
  'desktop/tests/fixtures/untrusted-key.pem',
  'relay/tests/fixtures/test-key.pem',
  'relay/tests/fixtures/untrusted-key.pem'
];

let files;
try {
  files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|pdf)$/i.test(f));
} catch (e) {
  console.error('❌ check:secrets — git ls-files failed, are we in a git repo?', e?.message || e);
  process.exit(1);
}

for (const rel of files) {
  if (ALLOWLIST_SUBSTRINGS.some((s) => rel.includes(s))) continue;
  const full = path.join(ROOT, rel);
  let content;
  try {
    content = fs.readFileSync(full, 'utf8');
  } catch {
    continue; // binary or unreadable — not this scanner's job
  }
  for (const { name, pattern } of PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      const line = content.slice(0, match.index).split('\n').length;
      FINDINGS.push({ file: rel, line, name });
    }
  }
}

if (FINDINGS.length) {
  console.error(`❌ check:secrets — ${FINDINGS.length} possible secret(s) found in tracked files:\n`);
  for (const f of FINDINGS) {
    console.error(`  ${f.file}:${f.line} — ${f.name}`);
  }
  console.error('\nIf this is a false positive (e.g. a deliberately-fake test fixture value),');
  console.error('add it to ALLOWLIST_SUBSTRINGS in scripts/check-secrets.mjs with a one-line');
  console.error('reason — never silently ignore a real finding. If this is a real committed');
  console.error('secret, see docs/RUNBOOK.md for rotation procedure before anything else.');
  process.exit(1);
}

console.log(`OK — ${files.length} tracked file(s) scanned, no committed-secret patterns found.`);
