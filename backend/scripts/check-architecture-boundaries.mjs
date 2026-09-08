#!/usr/bin/env node
// Enforces modular-monolith dependency direction for backend/src.
// Rules (see docs/ARCHITECTURE.md "Module boundaries"):
//   1. core/**              must not import Fastify/pg/grammy/node-cron/api/** directly
//                            (technical concerns belong to platform/data, not domain+application code).
//   2. data/repositories/** must not import from core/** (infrastructure must not depend on domain).
//   3. core/<moduleA>/**    must not import a *nested* private file of core/<moduleB>/**
//      (module_b/internal/x.ts) — top-level files directly under core/<module>/ are that
//      module's public surface (this codebase keeps modules flat, one file per concern;
//      see core/analytics/index.ts for the pattern used when a module's public surface
//      needs to be narrower than "every top-level file").
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');

const FORBIDDEN_CORE_PACKAGES = ['fastify', 'pg', 'grammy', 'node-cron'];
// Files that are legitimately infrastructure-flavored but live inside core/ for now
// (tracked as architecture debt in docs/ARCHITECTURE.md, not silently allowed forever).
const CORE_INFRA_EXCEPTIONS = new Set(['core/chat/realtime-bridge.ts']);
// Repository -> core imports that predate this check, documented as architecture debt
// in docs/ARCHITECTURE.md (moving them safely requires touching several call sites —
// deferred, not silently allowed to grow beyond this list).
const REPO_CORE_EXCEPTIONS = new Set(['data/repositories/sales.ts']);

/** @param {string} dir */
function walk(dir) {
  /** @type {string[]} */
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

  const isCore = rel.startsWith('core/');
  const isRepo = rel.startsWith('data/repositories/');

  if (isCore && !CORE_INFRA_EXCEPTIONS.has(rel)) {
    for (const spec of importLines) {
      if (FORBIDDEN_CORE_PACKAGES.includes(spec)) {
        violations.push(`${rel}: core module imports platform package '${spec}' directly`);
      }
      if (spec.includes('/api/routes/') || spec.startsWith('../../api/')) {
        violations.push(`${rel}: core module imports api/routes (${spec}) — wrong direction`);
      }
    }
  }

  if (isRepo && !REPO_CORE_EXCEPTIONS.has(rel)) {
    for (const spec of importLines) {
      const resolved = toPosix(join(dirname(rel), spec)).replace(/\.js$/, '');
      // core/shared/** is the shared-primitives/contracts layer — usable from any layer,
      // same as `shared/` at repo root (see docs/ARCHITECTURE.md).
      if (resolved.startsWith('core/') && !resolved.startsWith('core/shared/')) {
        violations.push(`${rel}: repository imports domain module '${spec}' — infrastructure must not depend on core`);
      }
    }
  }

  if (isCore) {
    const ownModule = rel.split('/')[1];
    for (const spec of importLines) {
      if (!spec.startsWith('..')) continue;
      const resolved = toPosix(join(dirname(rel), spec)).replace(/\.js$/, '');
      if (!resolved.startsWith('core/')) continue;
      const parts = resolved.split('/'); // ['core', module, ...pathBelowModule]
      const targetModule = parts[1];
      const isNested = parts.length > 3; // core/<module>/<subdir>/<file> — a private implementation file
      if (targetModule && targetModule !== ownModule && targetModule !== 'shared' && isNested) {
        violations.push(`${rel}: reaches into a nested/private file of core/${targetModule}/* (${spec}) — import from that module's top-level public file instead`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Architecture boundary check FAILED (${violations.length} violation(s)):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nSee docs/ARCHITECTURE.md for the dependency rules.');
  process.exit(1);
} else {
  console.log(`Architecture boundary check passed (${files.length} files scanned).`);
}
