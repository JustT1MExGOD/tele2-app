// Phase 2 of verify:installer-lifecycle — a plain Node script, run AFTER
// verify-installer-lifecycle.mjs's real-Electron phase (which necessarily
// exits before the detached watcher it spawns finishes — see that
// script's own header for why). This is what actually closes the
// "nothing propagates PASS/FAIL as a real exit code" gap: it polls for
// the watcher's result file, then turns `survived: false` into a real
// non-zero `process.exitCode` — the previous version of this check never
// did this at all; every "PASS" in this repo's history before this fix
// was a human manually reading the result file, never an enforced gate.
//
// Run via: npm run verify:installer-lifecycle (chains both phases).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULT_FILE = path.join(__dirname, '..', '.verify-installer-lifecycle-result.json');

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 15_000; // watcher fires at 4000ms after being spawned; generous margin

async function waitForResult() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(RESULT_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
      } catch {
        // still being written — keep polling
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

const result = await waitForResult();

if (result === null) {
  console.error(
    'FAIL: no result file appeared within the wait window — either the installer-lifecycle script was skipped (no built installer), or the watcher never ran/wrote its result.'
  );
  process.exitCode = 1;
} else if (result.survived) {
  console.log(`PASS: installer process survived app.quit() (new PID(s): ${result.newPids.join(', ') || 'none captured'}).`);
  process.exitCode = 0;
} else {
  console.error('FAIL: no new installer process was found alive after app.quit() — see .verify-installer-lifecycle-result.json for detail.');
  process.exitCode = 1;
}

try {
  fs.rmSync(RESULT_FILE, { force: true });
} catch {}
