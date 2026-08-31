// Real-Electron, real-relay regression check for the white-screen
// startup bug (post-20.56.0 acceptance, two passes):
//
// Pass 1 fixed the GENERIC case: relay-client.ts's PASSTHROUGH branch
// (session.fetch() for non-canonical-origin requests, e.g. a third-party
// <script src>) had no timeout at all — bounded to PASSTHROUGH_TIMEOUT_MS
// (10s) as defense-in-depth for ANY third-party resource.
//
// Pass 2 (this script's primary scenario) fixed the SPECIFIC, common
// case that made pass 1's 10s bound still too slow: index.html always
// loaded `https://telegram.org/js/telegram-web-app.js` as a render-
// blocking <script>, even on Desktop, which has zero Telegram-identity
// dependency (phone+password/cookie session — see access-supervisor/
// index.ts's bootApp()). index.html's inline bootstrap script now checks
// `window.t2Desktop` (set synchronously by the real preload's
// contextBridge — never spoofable by a real web page) and skips
// requesting telegram.org ENTIRELY on desktop, instead of merely timing
// out after 10s.
//
// This exercises the REAL production wiring end to end: real
// NetworkManager/state machine, real installRelayProtocolHandler, a real
// relay child process, a real BrowserWindow + real preload — not a
// mocked state machine, and (for scenario B below) the REAL index.html
// bootstrap markup, not a re-implementation of its logic.
//
// Self-contained — spawns its own fake upstream + TLS terminator + real
// relay child process, no manual setup required.
//
// Run: cd desktop && npm run desktop:build && node scripts/verify-network-startup.mjs
import { app, BrowserWindow, session } from 'electron';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.join(__dirname, '..');
const RELAY_DIR = path.join(DESKTOP_DIR, '..', 'relay');
const FIXTURE_DIR = path.join(RELAY_DIR, 'tests', 'fixtures');
const REAL_INDEX_HTML = path.join(DESKTOP_DIR, '..', 'backend', 'frontend', 'index.html');

const UPSTREAM_PORT = 24090;
const TERMINATOR_PORT = 24091;
const RELAY_PORT = 24092;
const UNREACHABLE_CANONICAL_ORIGIN = 'https://127.0.0.1:24999'; // nothing listens here -> fast, deterministic DIRECT failure
const UNREACHABLE_THIRD_PARTY = 'https://127.0.0.1:24998/blocked.js'; // nothing listens here -> deterministic passthrough failure
const USABLE_UI_BUDGET_MS = 2000; // §6 of the acceptance contract — measured from network_mode_changed -> relay, NOT from script start

/** Throws rather than calling process.exit() directly — process.exit()
 * doesn't synchronously halt the current function, so code after a
 * fail() call (e.g. the rest of a catch block, or the lines following an
 * early-return-shaped `if`) would otherwise keep running against
 * already-torn-down state (a real bug this test hit once: cleanup() had
 * already closed the servers/killed relay, but execution fell through to
 * `winD.webContents.executeJavaScript(...)`, throwing a confusing
 * secondary "Object has been destroyed" error that masked the real
 * failure). Throwing unwinds immediately; main().catch() at the bottom
 * does the actual logging + exit(1). */
function fail(reason) {
  throw new Error(reason);
}

async function waitForHealthz(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not become healthy within ${timeoutMs}ms`);
}

/** Extracts index.html's own inline bootstrap <script> (the one that
 * sets window.__t2TelegramScriptSettled) verbatim, so this test exercises
 * the REAL markup — not a hand-written re-implementation of its logic
 * that could silently drift from what actually ships. */
function extractRealBootstrapScript() {
  const html = fs.readFileSync(REAL_INDEX_HTML, 'utf8');
  const match = html.match(/<script>\s*window\.__t2TelegramScriptSettled[\s\S]*?<\/script>/);
  if (!match) {
    throw new Error('could not find the __t2TelegramScriptSettled inline bootstrap script in backend/frontend/index.html — has it moved/changed shape?');
  }
  return match[0];
}

async function main() {
  const cert = fs.readFileSync(path.join(FIXTURE_DIR, 'test-cert.pem'));
  const key = fs.readFileSync(path.join(FIXTURE_DIR, 'test-key.pem'));
  const realBootstrapScript = extractRealBootstrapScript();

  const upstream = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/generic-blocking-script') {
      // Scenario D (regression, unchanged from the pass-1 fix): an
      // unconditional render-blocking third-party script, unreachable —
      // proves the GENERIC PASSTHROUGH_TIMEOUT_MS bound still applies.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<!doctype html><html><head><script src="${UNREACHABLE_THIRD_PARTY}"></script></head>` +
          '<body id="app">GENERIC PAGE LOADED VIA RELAY</body></html>'
      );
      return;
    }
    // Scenario A/B (primary): the REAL index.html bootstrap markup,
    // verbatim, pointed at an unreachable telegram.org stand-in so a
    // desktop-detection FAILURE would still show up as a slow/blocked
    // load (same fail-loud property the generic timeout test relies on).
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><html><head>${realBootstrapScript.replace('https://telegram.org/js/telegram-web-app.js', UNREACHABLE_THIRD_PARTY)}</head>` +
        '<body id="app">CANONICAL PAGE LOADED VIA RELAY</body></html>'
    );
  });
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve);
  });

  const terminator = https.createServer({ cert, key }, (req, res) => {
    const proxyReq = http.request({ host: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    req.pipe(proxyReq);
  });
  await new Promise((resolve, reject) => {
    terminator.once('error', reject);
    terminator.listen(TERMINATOR_PORT, '127.0.0.1', resolve);
  });

  const relayProc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: RELAY_DIR,
    env: {
      ...process.env,
      RELAY_UPSTREAM_ORIGIN: `https://127.0.0.1:${TERMINATOR_PORT}`,
      PORT: String(RELAY_PORT),
      NODE_EXTRA_CA_CERTS: path.join(FIXTURE_DIR, 'test-cert.pem')
    },
    stdio: 'ignore',
    shell: true
  });
  const cleanup = () => {
    // `shell: true` on Windows spawns tsx as a grandchild of a cmd.exe
    // wrapper — a plain relayProc.kill() only kills the wrapper, leaking
    // the real relay process (and its bound port) across repeated runs.
    // `taskkill /T` kills the whole process tree; POSIX doesn't need this.
    if (process.platform === 'win32' && relayProc.pid) {
      spawn('taskkill', ['/pid', String(relayProc.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
    } else {
      relayProc.kill();
    }
    upstream.close();
    terminator.close();
  };
  process.on('exit', cleanup);

  try {
    await waitForHealthz(`http://127.0.0.1:${RELAY_PORT}/healthz`, 20_000);
  } catch (e) {
    cleanup();
    fail(`relay child process never became healthy: ${e.message}`);
  }

  await app.whenReady();

  const { loadDesktopConfig } = await import(pathToFileURL(path.join(DESKTOP_DIR, 'dist', 'main', 'config.js')).href);
  const { NetworkManager } = await import(pathToFileURL(path.join(DESKTOP_DIR, 'dist', 'main', 'network', 'manager.js')).href);

  process.env.T2_PUBLIC_APP_ORIGIN = UNREACHABLE_CANONICAL_ORIGIN;
  process.env.T2_RELAY_URL = `http://127.0.0.1:${RELAY_PORT}`;
  delete process.env.T2_NETWORK_MODE; // AUTO — the real default, exercising the real DIRECT->RELAY transition

  const config = loadDesktopConfig(process.env, true);
  const partition = 't2-sales-verify-network-startup';
  const appSession = session.fromPartition(partition);

  const networkManager = new NetworkManager({
    session: appSession,
    canonicalOrigin: config.publicAppOrigin,
    relayUrl: config.relayUrl,
    relayHost: config.relayHost,
    initialPreference: config.initialNetworkMode
  });

  // Mirrors main/index.ts exactly: networkManager.start() fully awaited
  // BEFORE the first navigation. One DIRECT-detection wait, reused by
  // both scenarios below — this is a real, shared property of a single
  // app process, not a per-navigation cost.
  await networkManager.start();
  if (networkManager.getStatus().effective !== 'relay') {
    cleanup();
    fail(`expected AUTO to resolve to 'relay' mode (DIRECT is deliberately unreachable), got '${networkManager.getStatus().effective}'`);
  }
  const relayTransitionAt = Date.now();

  function makeWindow() {
    return new BrowserWindow({
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(DESKTOP_DIR, 'dist', 'preload', 'index.js')
      }
    });
  }

  // --- Scenario A/B: the REAL index.html bootstrap, desktop-detected ---
  const winA = makeWindow();
  let didStartLoadingCountA = 0;
  winA.webContents.on('did-start-loading', () => didStartLoadingCountA++);
  const scenarioAStart = Date.now();
  try {
    await winA.loadURL(config.publicAppOrigin);
  } catch (e) {
    cleanup();
    fail(`[scenario A] mainWindow.loadURL() rejected — white-screen-shaped failure: ${e.message}`);
  }
  const scenarioAMs = Date.now() - scenarioAStart;
  const sinceRelayTransitionMs = Date.now() - relayTransitionAt;
  const bodyTextA = await winA.webContents.executeJavaScript('document.body ? document.body.innerText : "(no body)"').catch(() => '(executeJavaScript failed)');
  const t2DesktopPresent = await winA.webContents.executeJavaScript('typeof window.t2Desktop !== "undefined"').catch(() => false);
  // false = the desktop branch resolved immediately without ever
  // creating/appending a <script> element for telegram.org — the actual
  // "zero network request" property this scenario claims to prove, not
  // just "it happened to time out fast."
  const telegramScriptSettledValue = await winA.webContents
    .executeJavaScript('window.__t2TelegramScriptSettled')
    .catch(() => '(unavailable)');

  if (!bodyTextA.includes('CANONICAL PAGE LOADED VIA RELAY')) {
    cleanup();
    fail(`[scenario A] page did not render real content — white screen. body: ${JSON.stringify(bodyTextA)}`);
  }
  if (!t2DesktopPresent) {
    cleanup();
    fail('[scenario A] window.t2Desktop was not present in the renderer — desktop-detection precondition is broken, this test is not proving what it claims to');
  }
  // Must be exactly `false` (the desktop skip branch), not merely
  // "eventually settled" — and must have resolved near-instantly, not
  // via the 5s bootstrap-script timeout fallback, which would mean the
  // desktop branch was NOT actually taken.
  if (telegramScriptSettledValue !== false) {
    cleanup();
    fail(`[scenario A] window.__t2TelegramScriptSettled resolved to ${JSON.stringify(telegramScriptSettledValue)}, expected exactly false (the desktop skip branch) — a script element may have been created`);
  }
  if (didStartLoadingCountA !== 1) {
    cleanup();
    fail(`[scenario A] did-start-loading fired ${didStartLoadingCountA} times, expected exactly 1 — possible retry/reload loop`);
  }
  if (sinceRelayTransitionMs > USABLE_UI_BUDGET_MS) {
    cleanup();
    fail(`[scenario A] ${sinceRelayTransitionMs}ms elapsed between network_mode_changed->relay and a usable renderer — exceeds the ${USABLE_UI_BUDGET_MS}ms acceptance budget (§6)`);
  }
  // winA deliberately kept alive (not destroyed) rather than reused or
  // torn down before scenario D — empirically, destroying a BrowserWindow
  // while its session's protocol.handle registration is still active
  // breaks subsequent navigations on ANOTHER window sharing that same
  // session (a real Electron quirk found while writing this test, not a
  // production concern: a real packaged app has exactly one BrowserWindow
  // for its whole lifetime, never destroy-then-create on a shared
  // session). Both windows are cleaned up together at the very end.

  // --- Scenario D: generic unrelated third-party passthrough still bounded ---
  const winD = makeWindow();
  let didStartLoadingCountD = 0;
  winD.webContents.on('did-start-loading', () => didStartLoadingCountD++);
  const scenarioDStart = Date.now();
  try {
    await winD.loadURL(new URL('/generic-blocking-script', config.publicAppOrigin).toString());
  } catch (e) {
    cleanup();
    fail(`[scenario D] mainWindow.loadURL() rejected: ${e.message}`);
  }
  const scenarioDMs = Date.now() - scenarioDStart;
  const bodyTextD = await winD.webContents.executeJavaScript('document.body ? document.body.innerText : "(no body)"').catch(() => '(executeJavaScript failed)');
  cleanup();

  if (!bodyTextD.includes('GENERIC PAGE LOADED VIA RELAY')) {
    fail(`[scenario D] page did not render real content — white screen. body: ${JSON.stringify(bodyTextD)}`);
  }
  if (scenarioDMs > 30_000) {
    fail(`[scenario D] navigation took ${scenarioDMs}ms — the generic PASSTHROUGH_TIMEOUT_MS bound appears not to be applied`);
  }
  if (didStartLoadingCountD !== 1) {
    fail(`[scenario D] did-start-loading fired ${didStartLoadingCountD} times, expected exactly 1 — possible retry/reload loop`);
  }

  console.log(
    `PASS: [A] real index.html bootstrap, desktop-detected — ${sinceRelayTransitionMs}ms from relay transition to usable UI (budget ${USABLE_UI_BUDGET_MS}ms), t2Desktop present, telegram script skip-branch confirmed (settled=${telegramScriptSettledValue}), one navigation, no white screen (page load itself took ${scenarioAMs}ms). ` +
      `[D] generic unreachable third-party passthrough — still bounded (${scenarioDMs}ms), one navigation, no white screen.`
  );
  app.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
