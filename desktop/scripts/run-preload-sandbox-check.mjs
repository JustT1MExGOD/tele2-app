// Launcher for verify-preload-sandbox.mjs. That check needs to run as a
// REAL Electron main process (`import { app, BrowserWindow } from
// 'electron'` only resolves to the real API inside one) — running it
// under plain `node`, or under the electron binary with
// ELECTRON_RUN_AS_NODE set, makes 'electron' resolve to the CJS
// path-string shim instead, and the import fails before any check logic
// runs. Neither of those ever happens for a real user launching the
// packaged app — this launcher exists only so the check itself reliably
// exercises the real thing instead of silently testing nothing.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'verify-preload-sandbox.mjs');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [target], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
