#!/usr/bin/env node
// Enforces the frontend layer boundaries for backend/frontend/src (20.58.0
// architecture split — see docs/ARCHITECTURE.md). Target direction:
//
//   app -> pages/features/shared allowed
//   pages -> features/shared allowed (a page MAY use a feature)
//   features -> shared allowed
//   shared -> shared only
//
// Forbidden:
//   page -> page (no page imports another page directly)
//   feature -> page (endpoints/logic belong to their capability, not a
//     consuming page — this rule started scoped to features/*/api.ts in the
//     api-client split commit; generalized here to every file under features/)
//   cross-feature imports by default (a function needed by two features
//     should be reconsidered — moved to shared, not imported across)
//   shared -> features/pages/app (shared must never depend on anything above it)
//
// app/** is exempt from every rule below — assembling window.apiClient
// (app/api-bridge.ts) and owning shared session state (app/core.ts,
// app/nav.ts) both require reaching into pages/features by design.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'frontend', 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(sep).join('/');
}

const violations = [];
const files = walk(SRC);

for (const file of files) {
  const rel = toPosix(relative(SRC, file));
  const content = readFileSync(file, 'utf8');
  const importLines = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

  const topDir = rel.split('/')[0]; // 'app' | 'pages' | 'features' | 'shared'
  if (topDir === 'app') continue; // app is exempt from every rule below

  const ownUnit = rel.split('/')[1]; // page/feature name, or the shared subpath segment

  for (const spec of importLines) {
    if (!spec.startsWith('.')) continue;
    const resolved = toPosix(join(dirname(rel), spec)).replace(/\.js$/, '');
    const targetTopDir = resolved.split('/')[0];
    const targetUnit = resolved.split('/')[1];

    // Note: pages/features legitimately import app/router.js (registerPage) to
    // register themselves into the typed page registry — a small, stable
    // service surface app/ exposes, not "app assembling pages" in reverse.
    // Not restricted here; only the page/feature/shared rules below are enforced.

    if (topDir === 'shared') {
      if (targetTopDir === 'features' || targetTopDir === 'pages') {
        violations.push(`${rel}: shared/ imports from ${targetTopDir}/ (${spec}) — shared must depend on nothing above it`);
      }
      continue;
    }

    if (topDir === 'pages') {
      if (targetTopDir === 'pages' && targetUnit !== ownUnit) {
        violations.push(`${rel}: imports another page (${spec}) — page -> page is forbidden`);
      }
      continue;
    }

    if (topDir === 'features') {
      if (targetTopDir === 'pages') {
        violations.push(`${rel}: feature imports from pages/ (${spec}) — feature -> page is forbidden`);
      }
      if (targetTopDir === 'features' && targetUnit !== ownUnit) {
        violations.push(`${rel}: imports another feature (${spec}) — no cross-feature imports by default`);
      }
      continue;
    }
  }
}

if (violations.length > 0) {
  console.error(`Frontend architecture boundary check FAILED (${violations.length} violation(s)):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nSee docs/ARCHITECTURE.md for the frontend layer rules.');
  process.exit(1);
} else {
  console.log(`Frontend architecture boundary check passed (${files.length} files scanned).`);
}
