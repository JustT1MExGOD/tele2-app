/**
 * BrowserWindow factory with every hardening flag §4 of the brief
 * mandates. This is the one place a BrowserWindow gets created — no
 * other module in this app should call `new BrowserWindow(...)`
 * directly, so DESK-01/02/03/04/09 all reduce to "assert this one
 * object literal", checked by desktop-security.test.ts.
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';

/** Dedicated, named, persisted session partition — never Electron's
 * default session. Keeps this app's cookie jar isolated from anything
 * else Electron-based on the machine, and gives cookies/storage
 * durability across app restarts (needed for the RELAY session-
 * persistence acceptance check, Phase 8). */
export const SESSION_PARTITION = 'persist:t2-sales';

export function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'T2 Sales',
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js')
      // No `enableRemoteModule` — the `remote` module was removed from
      // Electron entirely years ago (not just disabled by default); not
      // re-enabling it is a non-action, not a flag to set.
    }
  });
}
