/**
 * Preload — the only bridge between sandboxed renderer and main process.
 * Exposes a minimal typed API; every method call is whitelisted here before
 * it can reach IPC, and again in the main-process handler.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionSnapshot } from '../main/connection';
import { isAllowedRendererMethod } from '../shared/whitelist';

export interface DesktopApi {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  getStatus(): Promise<ConnectionSnapshot>;
  retry(): Promise<ConnectionSnapshot>;
  listDistros(): Promise<string[]>;
  selectDistro(distro: string): Promise<ConnectionSnapshot>;
  onStateChange(callback: (snapshot: ConnectionSnapshot) => void): () => void;
}

const api: DesktopApi = {
  request(method, params) {
    if (!isAllowedRendererMethod(method)) {
      return Promise.reject(new Error(`method not allowed: ${method}`));
    }
    return ipcRenderer.invoke('bridge:request', method, params);
  },
  getStatus: () => ipcRenderer.invoke('bridge:status'),
  retry: () => ipcRenderer.invoke('bridge:retry'),
  listDistros: () => ipcRenderer.invoke('bridge:listDistros'),
  selectDistro: (distro) => ipcRenderer.invoke('bridge:selectDistro', distro),
  onStateChange(callback) {
    const listener = (_event: unknown, snapshot: ConnectionSnapshot) => callback(snapshot);
    ipcRenderer.on('bridge:state', listener as never);
    return () => ipcRenderer.removeListener('bridge:state', listener as never);
  },
};

contextBridge.exposeInMainWorld('piDesktop', api);
