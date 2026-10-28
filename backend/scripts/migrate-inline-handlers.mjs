#!/usr/bin/env node
/**
 * One-shot codemod (20.83.0): replaces inline
 * onclick/onchange/oninput/onsubmit attributes in frontend/index.html with
 * the data-on/data-arg delegation contract implemented in
 * frontend/src/app/nav.ts. Idempotent — already-migrated attributes are
 * skipped; anything it can't map is reported and left untouched.
 *
 * Run: node scripts/migrate-inline-handlers.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'frontend', 'index.html');
let html = readFileSync(file, 'utf8');

const RE = /(on(?:click|change|input|submit))="([^"]*)"/g;
const SIMPLE_CALL = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\(([^()]*)\)$/;

const unmappable = [];
let migrated = 0;

html = html.replace(RE, (whole, event, expr) => {
  const trimmed = expr.trim();

  // Special case 1: DOM proxy — document.getElementById('x').click()
  const proxy = trimmed.match(/^document\.getElementById\('([^']+)'\)\.click\(\)$/);
  if (proxy && event === 'onclick') {
    migrated++;
    return `data-click-el="${proxy[1]}"`;
  }

  // Special case 2: two statements — historyEmployeeFilter=null;switchPage('history')
  if (trimmed === "historyEmployeeFilter=null;switchPage('history')" && event === 'onclick') {
    migrated++;
    return 'data-reset-history-filter';
  }

  const call = trimmed.match(SIMPLE_CALL);
  if (!call) {
    unmappable.push(`${event}="${trimmed}"`);
    return whole;
  }
  const [, fn, rawArgs] = call;
  const args = rawArgs.trim();
  migrated++;
  const on = event.replace(/^on/, ''); // onclick -> click
  if (args === '') return `data-on="${fn}" data-on-event="${on}"`;
  // Single literal arg (number, 'string', true) or `this` (element itself).
  if (args === 'this') return `data-on="${fn}" data-on-event="${on}"`;
  if (/^'[^']*'$/.test(args)) {
    const arg = args.slice(1, -1).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `data-on="${fn}" data-on-event="${on}" data-arg="${arg}"`;
  }
  if (/^-?[0-9]+$/.test(args) || args === 'true' || args === 'false') {
    return `data-on="${fn}" data-on-event="${on}" data-arg="${args}"`;
  }
  unmappable.push(`${event}="${trimmed}" (complex args)`);
  return whole;
});

if (unmappable.length) {
  console.error('Unmappable attributes left in place:');
  for (const u of unmappable) console.error('  ' + u);
  process.exit(1);
}

// Click/change/input dispatch — the delegator in nav.ts routes by
// data-on-event; default event is click when the attribute is absent.
// Nothing else to write into the markup itself.
writeFileSync(file, html);
console.log(`Migrated ${migrated} inline handler attributes in ${file}`);
