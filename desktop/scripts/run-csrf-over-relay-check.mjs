// Launcher for verify-csrf-over-relay.mjs — same reasoning as
// run-preload-sandbox-check.mjs: this check needs a real Electron main
// process, not plain `node` or an ELECTRON_RUN_AS_NODE-poisoned electron
// binary, or its 'electron' import fails before any check logic runs.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'verify-csrf-over-relay.mjs');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [target], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
