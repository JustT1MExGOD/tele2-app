#!/usr/bin/env node
// Detects import cycles across backend/src (no new dependency — plain DFS over
// a graph built from relative `from '...'` specifiers). See docs/ARCHITECTURE.md.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');

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

const files = walk(SRC);
const fileSet = new Set(files.map((f) => toPosix(relative(SRC, f))));

/** @type {Map<string, string[]>} */
const graph = new Map();

function resolveImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null; // external package
  let resolved = toPosix(join(dirname(fromRel), spec)).replace(/\.js$/, '.ts');
  if (fileSet.has(resolved)) return resolved;
  const asIndex = resolved.replace(/\.ts$/, '/index.ts');
  if (fileSet.has(asIndex)) return asIndex;
  return null;
}

for (const file of files) {
  const rel = toPosix(relative(SRC, file));
  const content = readFileSync(file, 'utf8');
  const specs = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const deps = specs.map((s) => resolveImport(rel, s)).filter((x) => x !== null);
  graph.set(rel, deps);
}

// DFS cycle detection, report each distinct cycle once.
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map(files.map((f) => [toPosix(relative(SRC, f)), WHITE]));
const stack = [];
const cycles = [];
const reported = new Set();

function dfs(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const dep of graph.get(node) ?? []) {
    if (color.get(dep) === GRAY) {
      const idx = stack.indexOf(dep);
      const cycle = stack.slice(idx).concat(dep);
      const key = [...new Set(cycle)].sort().join('>');
      if (!reported.has(key)) {
        reported.add(key);
        cycles.push(cycle);
      }
    } else if (color.get(dep) === WHITE) {
      dfs(dep);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}

for (const node of graph.keys()) {
  if (color.get(node) === WHITE) dfs(node);
}

if (cycles.length > 0) {
  console.error(`Circular dependency check FAILED (${cycles.length} cycle(s)):\n`);
  for (const c of cycles) console.error(`  - ${c.join(' -> ')}`);
  process.exit(1);
} else {
  console.log(`Circular dependency check passed (${files.length} files, 0 cycles).`);
}
