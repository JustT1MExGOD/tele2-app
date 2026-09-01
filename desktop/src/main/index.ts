/**
 * Desktop app entry point. Single-instance lock (§47), hardened
 * BrowserWindow (window.ts), navigation allowlist (navigation-policy.ts),
 * loads the real production frontend directly (no packaged copy — see
 * the plan's central architecture decision), wires the NetworkManager
 * and the IPC handlers backing window.t2Desktop.
 */
import { app, type BrowserWindow, ipcMain, session } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { createMainWindow, SESSION_PARTITION } from './window';
import { applyNavigationPolicy } from './navigation-policy';
import { loadDesktopConfig } from './config';
import { NetworkManager } from './network/manager';
import { UpdateManager } from './updater/manager';
import { configureUpdaterDiagnosticLog, writeUpdaterDiagnostic } from './updater/diagnostic-log';
import { logger } from './logging';
import { IPC_CHANNELS } from '../shared/ipc-contract';
import type { PlatformInfo } from '../shared/ipc-contract';
import type { NetworkModePreference } from './network/types';

const APP_VERSION = app.getVersion();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let networkManager: NetworkManager | null = null;
  let updateManager: UpdateManager | null = null;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // app.isPackaged is the real, Electron-native signal for "this is a
    // genuine packaged/installed build" vs. a dev run (`electron dist/
    // main/index.js`) — only a packaged build falls back to the
    // production relay default when T2_RELAY_URL is unset (see
    // config.ts's loadDesktopConfig doc comment).
    const config = loadDesktopConfig(process.env, app.isPackaged);
    const appSession = session.fromPartition(SESSION_PARTITION);

    networkManager = new NetworkManager({
      session: appSession,
      canonicalOrigin: config.publicAppOrigin,
      relayUrl: config.relayUrl,
      relayHost: config.relayHost,
      initialPreference: config.initialNetworkMode
    });

    // Updater control plane — deliberately independent of both the
    // canonical origin AND the relay (§14 of the updater brief): if
    // Railway is unreachable and RELAY is the only working transport for
    // the application itself, the updater must still work talking
    // directly to updates.vincere-mortem.ru, never routed through
    // relay.vincere-mortem.ru. %LOCALAPPDATA%\T2 Sales\updates\ — Electron
    // has no built-in localAppData path constant, so this reads the real
    // Windows env var directly, falling back to userData only for
    // non-Windows dev/test environments.
    const updateCacheDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'T2 Sales', 'updates');
    // §updater-diagnostic-pass — a small, local, append-only diagnostic
    // file distinct from the update cache above: one line per update
    // stage (see diagnostic-log.ts's field discipline — never a full
    // path/URL/secret), so a user hitting a real update failure has a
    // single small file to send instead of console output a packaged
    // app has no way to capture.
    configureUpdaterDiagnosticLog(path.join(app.getPath('userData'), 'logs', 'updater.log'));
    updateManager = new UpdateManager({
      updateBaseUrl: config.updateBaseUrl,
      channel: config.updateChannel,
      currentVersion: APP_VERSION,
      updateCacheDir
    });

    registerIpcHandlers(networkManager, updateManager);

    mainWindow = createMainWindow();
    applyNavigationPolicy(mainWindow, config.publicAppOrigin);

    networkManager.onStatusChanged((status) => {
      mainWindow?.webContents.send(IPC_CHANNELS.NETWORK_STATUS_CHANGED_EVENT, status);
    });
    updateManager.onStatusChanged((status) => {
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_STATUS_CHANGED_EVENT, status);
    });

    // Decide DIRECT vs RELAY BEFORE the first navigation, so the very
    // first page load already goes through whichever transport is
    // actually going to work — not "load DIRECT, discover it's broken,
    // reload."
    await networkManager.start();
    updateManager.start();

    await mainWindow.loadURL(config.publicAppOrigin);

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('window-all-closed', () => {
    networkManager?.dispose();
    updateManager?.dispose();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    networkManager?.dispose();
    updateManager?.dispose();
  });
}

function registerIpcHandlers(networkManager: NetworkManager, updateManager: UpdateManager): void {
  ipcMain.handle(IPC_CHANNELS.GET_VERSION, () => APP_VERSION);

  ipcMain.handle(IPC_CHANNELS.GET_PLATFORM_INFO, (): PlatformInfo => ({
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release()
  }));

  ipcMain.handle(IPC_CHANNELS.GET_NETWORK_STATUS, () => networkManager.getStatus());

  ipcMain.handle(IPC_CHANNELS.RUN_NETWORK_DIAGNOSTICS, () => networkManager.runDiagnosticsNow());

  ipcMain.handle(IPC_CHANNELS.RETRY_DIRECT_CONNECTION, () => networkManager.retryDirect());

  ipcMain.handle(IPC_CHANNELS.SET_NETWORK_MODE_PREFERENCE, (_event, mode: NetworkModePreference) => {
    return networkManager.setPreference(mode);
  });

  // Updater — every handler here takes NO parameters from the renderer
  // (§9 of the updater brief): there is no IPC channel through which the
  // renderer could supply a URL, a file path, or an install command. What
  // gets checked/downloaded/installed is entirely this process's own
  // UpdateManager state.
  ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, () => updateManager.checkNow());
  ipcMain.handle(IPC_CHANNELS.GET_UPDATE_STATUS, () => updateManager.getStatus());
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_UPDATE, () => updateManager.downloadUpdate());
  ipcMain.handle(IPC_CHANNELS.INSTALL_UPDATE, () =>
    updateManager.installUpdate(() => {
      // Give the NSIS installer window a moment to actually appear
      // before this process (and the file locks it holds on its own
      // installed files) goes away — matches §8's "close desktop if the
      // installer requires it" without guessing at exact NSIS timing.
      // §updater-install-lifecycle — this delay was never the cause of
      // the real install-doesn't-complete bug (a real Windows repro
      // reproduced the failure with this exact same delay); the fix was
      // install-launcher.ts's launch mechanism, not this timing.
      writeUpdaterDiagnostic({ stage: 'APP_QUIT_REQUESTED', currentVersion: APP_VERSION });
      setTimeout(() => app.quit(), 1500).unref();
    })
  );

  logger.info('ipc_handlers_registered');
}
