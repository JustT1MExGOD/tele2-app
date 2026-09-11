#!/usr/bin/env node
/**
 * 17-layer security hardening pass, Layer 9 (Веб-интерфейс) — regression
 * ratchet against NEW inline event-handler attributes (`onclick=`/
 * `onchange=`/`oninput=`/`onsubmit=`), the same class of debt CSP already
 * has to special-case as `unsafe-inline` for `script-src-attr`/
 * `style-src-attr` (see docs/SECURITY.md "known compromises" and
 * app.ts's helmet config). A full rewrite to addEventListener/event
 * delegation across every legacy page is a separate, much larger epoch
 * (comparable in size to the original Frontend Foundation migration) —
 * not attempted here. What this DOES do: freeze the current count as a
 * hard ceiling so the debt can only shrink from here, never grow, and
 * make that measurable in CI instead of "a doc says it's ~265+" (three
 * different, all-stale counts were found floating around the codebase
 * during this audit — a comment in app.ts, a figure in SECURITY.md, and
 * the actual current count — this script is now the one source of truth).
 *
 * Model — same as check-dangerous-js-patterns.mjs (plain grep across
 * frontend/index.html + frontend/src/**\/*.ts, no AST/ESLint): a full
 * AST-based "is this really an HTML-attribute onclick vs. a JS property
 * assignment" classifier would be more precise, but this codebase's own
 * convention (see that script's header comment) is to accept a coarser,
 * zero-dependency check over a more precise one requiring new tooling.
 * The 4 patterns below only match the literal `on<event>="`/`on<event>='`
 * HTML-attribute form (inside a template string or raw HTML) — a genuine
 * JS property assignment like `el.onclick = handler;` has a space before
 * `=` and is never flagged.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'frontend', 'index.html');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');

// Baseline at the time this ratchet was introduced (this audit pass) —
// counted fresh by this exact script's own logic (`node
// scripts/check-inline-event-handlers.mjs`), not carried over from an
// older doc figure — a plain unanchored grep for the same 4 attribute
// names lands on 311 across the same files; requiring the attribute to
// actually open a quoted HTML-attribute value (this script's real check)
// lands on 310, one of the 311 not being a genuine instance of the
// pattern. LOWER this number (and only this number, never raise it) when
// a migration pass genuinely removes inline handlers from a page — that
// is the intended way this debt shrinks over time. Never raise it to
// make a new addition pass; add addEventListener/event delegation
// instead (see docs/SECURITY.md §9).
const BASELINE = 310;

const PATTERN = /on(?:click|change|input|submit)=["']/g;

function countIn(content) {
  const matches = content.match(PATTERN);
  return matches ? matches.length : 0;
}

function walkTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    const base = entry.parentPath ?? entry.path ?? dir;
    out.push(path.join(base, entry.name));
  }
  return out;
}

let total = 0;
const perFile = [];

const htmlContent = fs.readFileSync(INDEX_HTML, 'utf8');
const htmlCount = countIn(htmlContent);
total += htmlCount;
if (htmlCount) perFile.push([path.relative(ROOT, INDEX_HTML), htmlCount]);

for (const file of walkTsFiles(SRC_DIR)) {
  const count = countIn(fs.readFileSync(file, 'utf8'));
  if (count) {
    total += count;
    perFile.push([path.relative(ROOT, file), count]);
  }
}

if (total > BASELINE) {
  console.error(`❌ Inline event-handler count regressed: ${total} found, baseline is ${BASELINE} (+${total - BASELINE}).`);
  console.error('\nNew inline onclick=/onchange=/oninput=/onsubmit= attribute(s) were added.');
  console.error('Use addEventListener/event delegation for new code instead — see docs/SECURITY.md §9');
  console.error('("Веб-интерфейс") and the CSP known-compromise note on script-src-attr/style-src-attr.\n');
  console.error('Files with the largest counts (not necessarily the new addition — re-run against');
  console.error('the base branch to diff if unsure which file changed):');
  perFile
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([file, count]) => console.error(`  ${count}\t${file}`));
  process.exit(1);
}

if (total < BASELINE) {
  console.log(`OK — ${total} inline event-handler attribute(s) found (baseline ${BASELINE}, improved by ${BASELINE - total}).`);
  console.log('Consider lowering BASELINE in scripts/check-inline-event-handlers.mjs to lock in this improvement.');
} else {
  console.log(`OK — ${total} inline event-handler attribute(s) found, at the ${BASELINE} baseline (no regression).`);
}
