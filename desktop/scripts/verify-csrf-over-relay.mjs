// Real-Electron, real-relay, real-backend regression check for the
// CSRF-over-RELAY bug (acceptance-hardening pass). Exercises the actual
// desktop RELAY transport (session.protocol.handle + relay-client.ts),
// not a curl-based or mocked harness — this is the ONLY way the three
// bugs this pass found were ever actually visible (see
// src/main/network/relay-client.ts's module doc comment for the full
// root-cause writeup).
//
// This is an INTEGRATION-tier check, not part of `npm test` — it needs
// a real local stack running first:
//   1. Local Postgres with a phone+password admin employee, TOTP
//      confirmed (see the acceptance-hardening report for the exact
//      seed script/credentials used this pass).
//   2. The real backend (`cd backend && npx tsx src/index.ts`) on
//      PORT=3099, pointed at that Postgres.
//   3. A local TLS terminator in front of it (backend is plain HTTP;
//      relay's RELAY_UPSTREAM_ORIGIN must be https://) — a bare Node
//      https server proxying to 127.0.0.1:3099 using
//      relay/tests/fixtures/test-cert.pem.
//   4. The real relay (`cd relay && npx tsx src/index.ts`) with
//      RELAY_UPSTREAM_ORIGIN pointed at the terminator, PORT=8787,
//      NODE_EXTRA_CA_CERTS set to the same test fixture cert.
//
// Run: cd desktop && npm run desktop:build && \
//   TEST_PHONE=+7... TEST_PASSWORD=... TEST_TOTP_SECRET=... \
//   node scripts/verify-csrf-over-relay.mjs
//
// Exits non-zero with a clear reason on any failure.
import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate as generateTotp } from 'otplib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANONICAL_ORIGIN = process.env.T2_PUBLIC_APP_ORIGIN || 'https://tele2-app-production.up.railway.app';
const RELAY_URL = process.env.T2_RELAY_URL || 'http://127.0.0.1:8787';
const PHONE = process.env.TEST_PHONE;
const PASSWORD = process.env.TEST_PASSWORD;
const TOTP_SECRET = process.env.TEST_TOTP_SECRET;

if (!PHONE || !PASSWORD || !TOTP_SECRET) {
  console.error('FAIL: set TEST_PHONE, TEST_PASSWORD, TEST_TOTP_SECRET env vars to a real local test account first.');
  process.exit(1);
}

function fail(reason) {
  console.error('FAIL:', reason);
  process.exit(1);
}

async function totpCode() {
  return generateTotp({ secret: TOTP_SECRET, epoch: Math.floor(Date.now() / 1000) });
}

app.whenReady().then(async () => {
  const { loadDesktopConfig } = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'main', 'config.js')).href);
  const { NetworkManager } = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'main', 'network', 'manager.js')).href);
  const { IPC_CHANNELS } = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'shared', 'ipc-contract.js')).href);

  process.env.T2_RELAY_URL = RELAY_URL;
  process.env.T2_NETWORK_MODE = 'relay';
  const config = loadDesktopConfig(process.env, true);

  // Deliberately NOT a `persist:`-prefixed partition — an earlier draft
  // used one and a stale t2_session cookie left over from a PREVIOUS run
  // caused a spurious CSRF failure on /auth/login/mfa (that endpoint
  // never expects a session cookie yet; a leftover one from a prior run
  // made requireCsrf() enforce a check this flow doesn't send a token
  // for). An in-memory partition starts genuinely fresh every run.
  const appSession = session.fromPartition('t2-sales-verify-csrf');
  const manager = new NetworkManager({
    session: appSession,
    canonicalOrigin: config.publicAppOrigin,
    relayUrl: config.relayUrl,
    relayHost: config.relayHost,
    initialPreference: config.initialNetworkMode
  });
  ipcMain.handle(IPC_CHANNELS.GET_NETWORK_STATUS, () => manager.getStatus());
  await manager.start();
  if (manager.getStatus().effective !== 'relay') fail(`expected RELAY mode, got ${manager.getStatus().effective} — is the local relay running?`);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 't2-sales-verify-csrf',
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, '..', 'dist', 'preload', 'index.js')
    }
  });

  await win.loadURL(CANONICAL_ORIGIN);
  await new Promise((r) => setTimeout(r, 2000));

  const loginResult = await win.webContents.executeJavaScript(`
    fetch(window.location.origin + '/auth/login', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({phone: ${JSON.stringify(PHONE)}, password: ${JSON.stringify(PASSWORD)}})
    }).then(r => r.json())
  `);
  if (!loginResult.ok || !loginResult.mfa_token) fail('login did not return an mfa_token: ' + JSON.stringify(loginResult));

  const code1 = await totpCode();
  const mfaResult = await win.webContents.executeJavaScript(`
    fetch(window.location.origin + '/auth/login/mfa', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({mfa_token: ${JSON.stringify(loginResult.mfa_token)}, method:'totp', code: ${JSON.stringify(code1)}})
    }).then(r => r.json())
  `);
  if (!mfaResult.ok) fail('MFA verify failed: ' + JSON.stringify(mfaResult));

  const docCookie = await win.webContents.executeJavaScript('document.cookie');
  if (!docCookie.includes('t2_csrf=')) fail('document.cookie does not contain t2_csrf after a successful login — the cookie-origin bug is back: ' + JSON.stringify(docCookie));

  const meResult = await win.webContents.executeJavaScript(`fetch(window.location.origin + '/me').then(r => r.json())`);
  if (!meResult.bound) fail('GET /me is not authenticated after login: ' + JSON.stringify(meResult));

  const missingCsrf = await win.webContents.executeJavaScript(`
    fetch(window.location.origin + '/auth/mfa/step-up', {
      method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({method:'totp', code:'000000'})
    }).then(r => r.status)
  `);
  if (missingCsrf !== 403) fail(`missing CSRF should be rejected with 403, got ${missingCsrf}`);

  const wrongCsrf = await win.webContents.executeJavaScript(`
    fetch(window.location.origin + '/auth/mfa/step-up', {
      method: 'POST', headers: {'content-type':'application/json', 'X-CSRF-Token': 'wrong'}, body: JSON.stringify({method:'totp', code:'000000'})
    }).then(r => r.status)
  `);
  if (wrongCsrf !== 403) fail(`wrong CSRF should be rejected with 403, got ${wrongCsrf}`);

  await new Promise((r) => setTimeout(r, 31000)); // clear the TOTP time-step
  const code2 = await totpCode();
  const validAttempt = await win.webContents.executeJavaScript(`
    (function() {
      const m = document.cookie.match(/(?:^|;\\s*)t2_csrf=([^;]+)/);
      const csrf = m ? decodeURIComponent(m[1]) : null;
      return fetch(window.location.origin + '/auth/mfa/step-up', {
        method: 'POST',
        headers: csrf ? {'content-type':'application/json', 'X-CSRF-Token': csrf} : {'content-type':'application/json'},
        body: JSON.stringify({method:'totp', code: ${JSON.stringify(code2)}})
      }).then(r => r.status);
    })()
  `);
  if (validAttempt !== 200) fail(`valid CSRF + valid TOTP should succeed with 200, got ${validAttempt}`);

  console.log('PASS: full CSRF lifecycle over the real desktop RELAY transport — login, MFA, cookies on canonical origin, authenticated GET, missing/wrong CSRF rejected, valid CSRF accepted.');
  app.quit();
});
