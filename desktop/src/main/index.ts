/**
 * Desktop app entry point. Single-instance lock (§47), hardened
 * BrowserWindow (window.ts), navigation allowlist (navigation-policy.ts),
 * loads the real production frontend directly (no packaged copy — see
 * the plan's central architecture decision), wires the NetworkManager
 * and the IPC handlers backing window.t2Desktop.
 */
import { app, type BrowserWindow, ipcMain, session } from 'electron';
import os from 'node:os';
import { createMainWindow, SESSION_PARTITION } from './window';
import { applyNavigationPolicy } from './navigation-policy';
import { loadDesktopConfig } from './config';
import { NetworkManager } from './network/manager';
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

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const config = loadDesktopConfig();
    const appSession = session.fromPartition(SESSION_PARTITION);

    networkManager = new NetworkManager({
      session: appSession,
      canonicalOrigin: config.publicAppOrigin,
      relayUrl: config.relayUrl,
      initialPreference: config.initialNetworkMode
    });

    registerIpcHandlers(networkManager);

    mainWindow = createMainWindow();
    applyNavigationPolicy(mainWindow, config.publicAppOrigin);

    networkManager.onStatusChanged((status) => {
      mainWindow?.webContents.send(IPC_CHANNELS.NETWORK_STATUS_CHANGED_EVENT, status);
    });

    // Decide DIRECT vs RELAY BEFORE the first navigation, so the very
    // first page load already goes through whichever transport is
    // actually going to work — not "load DIRECT, discover it's broken,
    // reload."
    await networkManager.start();

    await mainWindow.loadURL(config.publicAppOrigin);

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('window-all-closed', () => {
    networkManager?.dispose();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    networkManager?.dispose();
  });
}

function registerIpcHandlers(networkManager: NetworkManager): void {
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

  logger.info('ipc_handlers_registered');
}
