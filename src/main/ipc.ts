/**
 * Main-process IPC surface. Channels are fixed; the method argument is
 * checked against the shared read-only whitelist before touching the
 * connection. Snapshots are pushed to renderers on `bridge:state`.
 */
import { isAllowedRendererMethod } from '../shared/whitelist';

export interface IpcLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface ConnectionLike {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  snapshot(): unknown;
  retry(): unknown;
  listDistros(): Promise<string[]>;
  selectDistro(distro: string): void;
  subscribe(cb: (snapshot: unknown) => void): () => void;
  subscribeChat(cb: (payload: unknown) => void): () => void;
}

export interface IpcOptions {
  onDistroChange?: (distro: string) => void;
}

export function registerIpc(
  ipc: IpcLike,
  conn: ConnectionLike,
  send: (channel: string, payload: unknown) => void,
  options: IpcOptions = {},
): () => void {
  ipc.handle('bridge:request', async (_e, method, params) => {
    if (typeof method !== 'string' || !isAllowedRendererMethod(method)) {
      throw new Error(`method not allowed: ${String(method)}`);
    }
    try {
      return await conn.request(method, typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : undefined);
    } catch (err) {
      // Electron serializes Errors by message only — prefix the stable code
      // so the renderer can show SESSION_CONFLICT / RESOURCE_BUSY / …
      const e = err as { code?: unknown; message?: unknown };
      if (typeof e?.code === 'string' && e.code.length > 0) {
        throw new Error(`${e.code}: ${typeof e.message === 'string' ? e.message : ''}`, { cause: err });
      }
      throw err;
    }
  });
  ipc.handle('bridge:status', () => conn.snapshot());
  ipc.handle('bridge:retry', () => {
    conn.retry();
    return conn.snapshot();
  });
  ipc.handle('bridge:listDistros', () => conn.listDistros());
  ipc.handle('bridge:selectDistro', async (_e, distro) => {
    if (typeof distro !== 'string' || distro.length === 0) {
      throw new Error('distro must be a non-empty string');
    }
    conn.selectDistro(distro);
    options.onDistroChange?.(distro);
    return conn.snapshot();
  });

  const offState = conn.subscribe((snapshot) => send('bridge:state', snapshot));
  const offChat = conn.subscribeChat((payload) => send('bridge:chat', payload));
  return () => {
    offState();
    offChat();
  };
}
