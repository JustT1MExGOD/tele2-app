/**
 * Typed IPC channel names + payload shapes, shared between main and
 * preload. Deliberately a closed, minimal set — §6 of the 20.55.0 brief:
 * no generic invoke(command, args), no exec/spawn/readFile/writeFile/
 * fetch(url)/openSocket. Every channel here is one specific operation
 * with a fixed payload shape.
 */
import type { NetworkStatus, DiagnosticsReport, NetworkModePreference } from '../main/network/types';
import type { UpdateStatus } from '../main/updater/types';

export const IPC_CHANNELS = {
  GET_VERSION: 't2:get-version',
  GET_PLATFORM_INFO: 't2:get-platform-info',
  GET_NETWORK_STATUS: 't2:get-network-status',
  RUN_NETWORK_DIAGNOSTICS: 't2:run-network-diagnostics',
  RETRY_DIRECT_CONNECTION: 't2:retry-direct-connection',
  SET_NETWORK_MODE_PREFERENCE: 't2:set-network-mode-preference',
  NETWORK_STATUS_CHANGED_EVENT: 't2:network-status-changed',
  // Updater (§9 of the updater brief) — exactly these 4 named operations,
  // no parameters accepted from the renderer at all (no URL, no path, no
  // command) — installUpdate() always launches whatever THIS process
  // itself already downloaded and verified, never something the
  // renderer specifies.
  CHECK_FOR_UPDATES: 't2:check-for-updates',
  GET_UPDATE_STATUS: 't2:get-update-status',
  DOWNLOAD_UPDATE: 't2:download-update',
  INSTALL_UPDATE: 't2:install-update',
  UPDATE_STATUS_CHANGED_EVENT: 't2:update-status-changed'
} as const;

export interface PlatformInfo {
  platform: string;
  arch: string;
  osVersion: string;
}

/** The exact typed surface exposed on window.t2Desktop by the preload
 * script — see desktop/src/preload/index.ts. */
export interface T2DesktopAPI {
  getVersion(): Promise<string>;
  getPlatformInfo(): Promise<PlatformInfo>;
  getNetworkStatus(): Promise<NetworkStatus>;
  runNetworkDiagnostics(): Promise<DiagnosticsReport>;
  retryDirectConnection(): Promise<void>;
  setNetworkModePreference(mode: NetworkModePreference): Promise<void>;
  onNetworkStatusChanged(cb: (status: NetworkStatus) => void): () => void;
  checkForUpdates(): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatusChanged(cb: (status: UpdateStatus) => void): () => void;
}
