#!/usr/bin/env node
// Freezes the set of bare mutable globals declared in
// frontend/src/shared/legacy-globals.d.ts (20.58.0 architecture split,
// corr. #6). These are app/core.ts's/app/nav.ts's shared mutable state —
// `me`, `stores`, `employees`, `saleSelection`, `scheduleMonth`, `planMonth`,
// `adminViewOrgId`, `METRICS`, `page` — read/written as bare identifiers by
// ~15 other bundles via the JS Global Environment Record (see
// docs/ARCHITECTURE.md's "Legacy global state" section for the full
// mechanism and why it isn't migrated away in this pass).
//
// This script does NOT check the ~80 `function foo(): ...` bridge
// declarations in the same file (the legacy onclick="..." HTML dispatch
// mechanism) — that's a different, much larger migration concern, out of
// scope here. It checks only the mutable state surface: every top-level
// `let <name>: ...;` in the `declare global { ... }` block. If this list
// grows beyond FROZEN_GLOBALS, the check fails — not because a new global
// can never be added, but because doing so should be a visible, reviewed
// decision (update this list and explain why), not silent drift.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'frontend', 'src', 'shared', 'legacy-globals.d.ts');

const FROZEN_GLOBALS = new Set([
  'me', 'adminViewOrgId', 'stores', 'METRICS', 'employees', 'saleSelection',
  'scheduleMonth', 'planMonth', 'page'
]);

const content = readFileSync(FILE, 'utf8');
const declareGlobalStart = content.indexOf('declare global {');
const body = content.slice(declareGlobalStart);

// Top-level `let <name>` inside declare global { ... } — mutable state only.
// `const <name>` bindings (API, APP_VERSION, OfflineQueue, page — wait, page
// is `const` in the ambient decl even though window.page is mutable; see
// note below) are set-once bridges, a different kind of thing, not tracked here.
const found = new Set();
for (const m of body.matchAll(/^\s{2}let\s+([A-Za-z_$][\w$]*)\s*:/gm)) {
  found.add(m[1]);
}
// `page` is declared `const page: string` in the bare-identifier block (line
// ~103) but `window.page` (the Object Record half of the same lookup) is
// genuinely mutable — reassigned by app/nav.ts's switchPage(). Tracked
// explicitly since the interface-level `page: string;` on Window (not `const`)
// is what the regex above can't see.
found.add('page');

const newGlobals = [...found].filter((g) => !FROZEN_GLOBALS.has(g));
const removedGlobals = [...FROZEN_GLOBALS].filter((g) => !found.has(g));

if (newGlobals.length > 0) {
  console.error(`Frontend legacy-globals freeze check FAILED — new bare global(s) not in the frozen list:\n`);
  for (const g of newGlobals) console.error(`  - ${g}`);
  console.error('\nAdding a new shared mutable global to shared/legacy-globals.d.ts is a real');
  console.error('architecture decision (it grows the bare-global surface every bundle can read/');
  console.error('write) — update FROZEN_GLOBALS in this script once that decision is deliberate,');
  console.error('and add a typed accessor for it in app/state.ts alongside the others.');
  process.exit(1);
} else if (removedGlobals.length > 0) {
  console.log(`Frontend legacy-globals freeze check: ${removedGlobals.join(', ')} no longer declared — shrink FROZEN_GLOBALS in this script to match (not a failure, just stale).`);
} else {
  console.log(`Frontend legacy-globals freeze check passed (${found.size} frozen globals, unchanged).`);
}
