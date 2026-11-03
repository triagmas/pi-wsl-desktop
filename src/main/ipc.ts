/**
 * Main-process IPC surface. Channels are fixed; the method argument is
 * checked against the shared read-only whitelist before touching the
 * connection. Snapshots are pushed to renderers on `bridge:state`.
 */
import { isAllowedRendererMethod } from '../shared/whitelist';
import { methodTimeoutMs } from '../shared/timeouts';
import { loadAppearance, resetAppearance, saveAppearance } from './appearanceStore';
import { migrateAppearance } from '../shared/appearance';
import { TerminalError, type TerminalOpenRequest, type TerminalSession } from '../shared/terminal';
import type { MetricsSample } from '../shared/terminalMetrics';

export interface IpcLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface ConnectionLike {
  /**
   * UI21 F1-B R02: тайм-аут задаёт вызывающая сторона. Main должен передавать
   * внешний бюджет метода (он больше внутреннего бюджета Pi) — иначе медленный,
   * но успешный ACK превращается в ложный BRIDGE_TIMEOUT.
   */
  request(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<unknown>;
  snapshot(): unknown;
  retry(): unknown;
  listDistros(): Promise<string[]>;
  selectDistro(distro: string): void;
  subscribe(cb: (snapshot: unknown) => void): () => void;
  subscribeChat(cb: (payload: unknown) => void): () => void;
}

/** Терминальный хост main-процесса: только эти четыре операции доступны renderer. */
export interface TerminalHost {
  open(request: TerminalOpenRequest): TerminalSession;
  /** Renderer подключил обработчик событий этой сессии (ранний буфер). */
  attach(id: string): boolean;
  write(id: string, dataB64: string): boolean;
  resize(id: string, cols: number, rows: number): void;
  close(id: string): void;
}

/** Источник метрик хоста (main): renderer получает готовый снимок. */
export interface MetricsHost {
  sample(): MetricsSample;
}

export interface IpcOptions {
  onDistroChange?: (distro: string) => void;
  /** Directory for the appearance store (app userData in production). */
  appearanceDir?: string;
  /** D2 frameless window: host-provided controls. Absent ⇒ channels unregistered (fail closed). */
  windowControls?: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  /** UI-B: реальный PTY. Без хоста каналы не регистрируются (fail closed). */
  terminal?: TerminalHost;
  /** UI-B: метрики Windows-хоста. Без хоста канал не регистрируется. */
  metrics?: MetricsHost;
}

function fail(prefix: string, message: string): never {
  throw new Error(`${prefix}: ${message}`);
}

function rethrow(err: unknown): never {
  if (err instanceof TerminalError) throw new Error(err.message);
  const coded = err as { code?: unknown; message?: unknown };
  if (typeof coded?.code === 'string' && coded.code.length > 0) {
    throw new Error(`${coded.code}: ${typeof coded.message === 'string' ? coded.message : ''}`, { cause: err });
  }
  throw err;
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
      return await conn.request(
        method,
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : undefined,
        { timeoutMs: methodTimeoutMs(method) },
      );
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

  // D2: frameless TitleBar controls — only wired when the host window exists;
  // unit/test hosts get no channels at all (renderer guards on api presence).
  const win = options.windowControls;
  if (win) {
    ipc.handle('window:minimize', () => win.minimize());
    ipc.handle('window:maximize', () => win.maximize());
    ipc.handle('window:close', () => win.close());
  }

  // UI-B: терминал и метрики — отдельные типизированные каналы. Значения из
  // renderer проверяются здесь, а не только в preload: renderer может быть
  // скомпрометирован, main остаётся доверенной границей.
  const terminal = options.terminal;
  if (terminal) {
    ipc.handle('terminal:open', (_e, payload) => {
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        fail('terminal:open', 'ожидается объект {distro, cwd, cols, rows}');
      }
      const { distro, cwd, cols, rows } = payload as Record<string, unknown>;
      if (typeof distro !== 'string' || typeof cwd !== 'string') {
        fail('terminal:open', 'distro и cwd должны быть строками');
      }
      if (typeof cols !== 'number' || typeof rows !== 'number') {
        fail('terminal:open', 'cols и rows должны быть числами');
      }
      try {
        return terminal.open({ distro, cwd, cols, rows });
      } catch (err) {
        rethrow(err);
      }
    });
    ipc.handle('terminal:attach', (_e, id) => {
      if (typeof id !== 'string' || id.length === 0) fail('terminal:attach', 'некорректный id сессии');
      return terminal.attach(id);
    });
    ipc.handle('terminal:write', (_e, id, dataB64) => {
      if (typeof id !== 'string' || id.length === 0) fail('terminal:write', 'некорректный id сессии');
      if (typeof dataB64 !== 'string') fail('terminal:write', 'данные должны быть base64-строкой');
      return terminal.write(id, dataB64);
    });
    ipc.handle('terminal:resize', (_e, id, cols, rows) => {
      if (typeof id !== 'string' || id.length === 0) fail('terminal:resize', 'некорректный id сессии');
      if (typeof cols !== 'number' || typeof rows !== 'number') fail('terminal:resize', 'cols и rows должны быть числами');
      terminal.resize(id, cols, rows);
    });
    ipc.handle('terminal:close', (_e, id) => {
      if (typeof id !== 'string' || id.length === 0) fail('terminal:close', 'некорректный id сессии');
      terminal.close(id);
    });
  }

  const metrics = options.metrics;
  if (metrics) {
    ipc.handle('metrics:get', () => metrics.sample());
  }

  const offState = conn.subscribe((snapshot) => send('bridge:state', snapshot));
  const offChat = conn.subscribeChat((payload) => send('bridge:chat', payload));
  return () => {
    offState();
    offChat();
  };
}
