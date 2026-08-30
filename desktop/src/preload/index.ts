/**
 * Preload script — the ONLY bridge between the renderer (the real T2
 * Sales web app, loaded unmodified) and the main process. Exposes
 * exactly the typed `window.t2Desktop` surface from
 * shared/ipc-contract.ts via contextBridge, running with
 * contextIsolation:true — the renderer has no Node/Electron access
 * beyond this explicit, minimal surface (§6 of the brief).
 *
 * No exec/spawn/readFile/writeFile/fetch(url)/openSocket/generic
 * invoke(command, args) — every channel below is one specific named IPC
 * call with a fixed payload shape.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type T2DesktopAPI } from '../shared/ipc-contract';
import { installNetworkStatusOverlay } from './network-overlay';

const api: T2DesktopAPI = {
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_VERSION),
  getPlatformInfo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PLATFORM_INFO),
  getNetworkStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_NETWORK_STATUS),
  runNetworkDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.RUN_NETWORK_DIAGNOSTICS),
  retryDirectConnection: () => ipcRenderer.invoke(IPC_CHANNELS.RETRY_DIRECT_CONNECTION),
  setNetworkModePreference: (mode) => ipcRenderer.invoke(IPC_CHANNELS.SET_NETWORK_MODE_PREFERENCE, mode),
  onNetworkStatusChanged: (cb) => {
    const listener = (_event: IpcRendererEvent, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on(IPC_CHANNELS.NETWORK_STATUS_CHANGED_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NETWORK_STATUS_CHANGED_EVENT, listener);
  }
};

contextBridge.exposeInMainWorld('t2Desktop', api);

installNetworkStatusOverlay(api);
