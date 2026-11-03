/**
 * Preload — the only bridge between sandboxed renderer and main process.
 * Exposes a minimal typed API; every method call is whitelisted here before
 * it can reach IPC, and again in the main-process handler.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionSnapshot } from '../main/connection';
import { isAllowedRendererMethod } from '../shared/whitelist';
import type { TerminalEvent, TerminalOpenRequest, TerminalSession } from '../shared/terminal';
import type { MetricsSample } from '../shared/terminalMetrics';

export interface DesktopApi {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  getStatus(): Promise<ConnectionSnapshot>;
  retry(): Promise<ConnectionSnapshot>;
  listDistros(): Promise<string[]>;
  selectDistro(distro: string): Promise<ConnectionSnapshot>;
  onStateChange(callback: (snapshot: ConnectionSnapshot) => void): () => void;
  onChatEvent(callback: (payload: unknown) => void): () => void;
  /**
   * UI-B: узкий типизированный контракт терминала. Renderer не получает
   * ни Node.js, ни произвольный shell: только эти четыре операции и события.
   */
  terminal: {
    open(request: TerminalOpenRequest): Promise<TerminalSession>;
    /** Подписка renderer на события сессии: отдаёт накопленные ранние кадры. */
    attach(id: string): Promise<boolean>;
    write(id: string, dataB64: string): Promise<boolean>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    close(id: string): Promise<void>;
    onEvent(callback: (event: TerminalEvent) => void): () => void;
  };
  /** UI-B: снимок CPU/RAM Windows-хоста (считает main-процесс). */
  getMetrics(): Promise<MetricsSample>;
  getAppearance(): Promise<unknown>;
  saveAppearance(settings: unknown): Promise<unknown>;
  resetAppearance(): Promise<unknown>;
  /** D2 frameless window controls (channels registered by main). */
  windowControls?: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
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
  onChatEvent(callback) {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('bridge:chat', listener as never);
    return () => ipcRenderer.removeListener('bridge:chat', listener as never);
  },
  terminal: {
    open: (request) => ipcRenderer.invoke('terminal:open', request) as Promise<TerminalSession>,
    attach: (id) => ipcRenderer.invoke('terminal:attach', id) as Promise<boolean>,
    write: (id, dataB64) => ipcRenderer.invoke('terminal:write', id, dataB64) as Promise<boolean>,
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows).then(() => undefined),
    close: (id) => ipcRenderer.invoke('terminal:close', id).then(() => undefined),
    onEvent(callback) {
      const listener = (_event: unknown, payload: TerminalEvent) => callback(payload);
      ipcRenderer.on('terminal:event', listener as never);
      return () => ipcRenderer.removeListener('terminal:event', listener as never);
    },
  },
  getMetrics: () => ipcRenderer.invoke('metrics:get') as Promise<MetricsSample>,
  getAppearance: () => ipcRenderer.invoke('appearance:get'),
  saveAppearance: (settings) => ipcRenderer.invoke('appearance:set', settings),
  resetAppearance: () => ipcRenderer.invoke('appearance:reset'),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize').then(() => undefined),
    maximize: () => ipcRenderer.invoke('window:maximize').then(() => undefined),
    close: () => ipcRenderer.invoke('window:close').then(() => undefined),
  },
};

contextBridge.exposeInMainWorld('piDesktop', api);
