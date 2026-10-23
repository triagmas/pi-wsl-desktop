/**
 * Main-process IPC surface. Channels are fixed; the method argument is
 * checked against the shared read-only whitelist before touching the
 * connection. Snapshots are pushed to renderers on `bridge:state`.
 */
import { isAllowedRendererMethod } from '../shared/whitelist';
import { loadAppearance, resetAppearance, saveAppearance } from './appearanceStore';
import { migrateAppearance } from '../shared/appearance';

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
  /** Directory for the appearance store (app userData in production). */
  appearanceDir?: string;
  /** Push validated title-bar overlay colors onto the native caption (A1). */
  onTitleBarOverlay?: (colors: { backgroundColor: string; textColor: string }) => void;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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

  // Appearance (§9.1 item 5): validate/migrate on the way in, fail-safe on read.
  const appearanceDir = options.appearanceDir;
  ipc.handle('appearance:get', () =>
    appearanceDir ? loadAppearance(appearanceDir) : migrateAppearance(undefined),
  );
  ipc.handle('appearance:set', (_e, settings) => {
    if (!appearanceDir) return migrateAppearance(settings);
    return saveAppearance(appearanceDir, migrateAppearance(settings));
  });
  ipc.handle('appearance:reset', () =>
    appearanceDir ? resetAppearance(appearanceDir) : migrateAppearance(undefined),
  );

  // A1: renderer-driven caption colors, fail-closed — only exact #RRGGBB.
  ipc.handle('window:setTitleBarOverlay', (_e, colors) => {
    const payload = colors as { backgroundColor?: unknown; textColor?: unknown } | null;
    const backgroundColor = typeof payload?.backgroundColor === 'string' ? payload.backgroundColor : '';
    const textColor = typeof payload?.textColor === 'string' ? payload.textColor : '';
    if (!HEX_COLOR.test(backgroundColor) || !HEX_COLOR.test(textColor)) {
      throw new Error('titleBarOverlay colors must be #RRGGBB hex values');
    }
    options.onTitleBarOverlay?.({ backgroundColor, textColor });
    return true;
  });

  const offState = conn.subscribe((snapshot) => send('bridge:state', snapshot));
  const offChat = conn.subscribeChat((payload) => send('bridge:chat', payload));
  return () => {
    offState();
    offChat();
  };
}
