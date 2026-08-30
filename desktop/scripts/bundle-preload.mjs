// Electron's sandboxed preload environment (webPreferences.sandbox:true,
// a hard security requirement — see docs/DESKTOP-SECURITY.md) does NOT
// support Node-style multi-file `require()` resolution at runtime, not
// even a same-directory relative require — its preload module loader is
// a small whitelist-based shim, not the real Node resolver. tsc's normal
// multi-file CommonJS output (dist/preload/index.js requiring
// ./network-overlay and ../shared/ipc-contract) therefore silently fails
// to load in any real sandboxed run — confirmed empirically via
// `webContents.on('preload-error', ...)` during the acceptance-prep
// pass ("Error: module not found: ../shared/ipc-contract"), a
// previously-undetected bug that made window.t2Desktop (and everything
// built on it, including the network-status overlay) never actually
// exist in a real launch.
//
// Fix: bundle the ALREADY-tsc-compiled preload entry (dist/preload/
// index.js) and its local requires into one self-contained file, in
// place, after tsc runs. Only the preload output is touched — main
// process files stay normal multi-file CommonJS (sandbox restrictions
// only apply to preload). `electron` itself is left external (a
// runtime-provided module, never bundled).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, '..', 'dist', 'preload', 'index.js');

await build({
  entryPoints: [entry],
  outfile: entry,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['electron'],
  allowOverwrite: true,
  minify: false
});

console.log('bundled preload ->', entry);
