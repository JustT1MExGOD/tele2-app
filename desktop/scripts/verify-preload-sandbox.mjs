// Real-Electron regression check for a severe bug found during the
// 20.55.0 acceptance-prep pass: Electron's sandboxed preload
// (webPreferences.sandbox:true, a hard security requirement) does not
// support Node-style multi-file `require()` at runtime — not even a
// same-directory relative require. tsc's normal multi-file CommonJS
// output therefore silently failed to load in any real sandboxed run,
// meaning `window.t2Desktop` never actually existed. vitest (Node
// environment) cannot catch this class of bug — it requires a real,
// non-ELECTRON_RUN_AS_NODE Electron process. This script is that check.
//
// Run manually (not part of the default `npm test`/CI unit suite, which
// must stay fast and must not depend on a real windowed Electron
// process or the production origin):
//   cd desktop && npm run desktop:build && node scripts/verify-preload-sandbox.mjs
//
// Exits non-zero and prints the failure reason if window.t2Desktop or
// the sanitized network-status overlay element is missing after a real
// page load.
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'persist:t2-sales-verify',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'dist', 'preload', 'index.js')
    }
  });

  let preloadError = null;
  win.webContents.on('preload-error', (_e, _p, error) => {
    preloadError = error?.message ?? String(error);
  });

  // A minimal local page is enough — this checks preload loading and DOM
  // injection, not the real production app's own content.
  await win.loadURL('data:text/html,<!doctype html><html><body></body></html>');
  await new Promise((r) => setTimeout(r, 1000));

  if (preloadError) {
    console.error('FAIL: preload-error event fired:', preloadError);
    process.exit(1);
  }

  const t2DesktopType = await win.webContents.executeJavaScript('typeof window.t2Desktop');
  if (t2DesktopType !== 'object') {
    console.error(`FAIL: window.t2Desktop is "${t2DesktopType}", expected "object" — preload did not expose the API.`);
    process.exit(1);
  }

  const overlayExists = await win.webContents.executeJavaScript(
    "!!document.getElementById('t2desktop-network-status')"
  );
  if (!overlayExists) {
    console.error('FAIL: sanitized network-status overlay element was not injected into the DOM.');
    process.exit(1);
  }

  console.log('PASS: window.t2Desktop exposed and network-status overlay injected under a real sandboxed preload.');
  app.quit();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
