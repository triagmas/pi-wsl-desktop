/**
 * Bridge method handlers — the M0 read-only allowlist.
 *
 * Every handler is a pure read/diagnostic operation: no file writes, no
 * session creation, no model calls. Writes are out of scope for M0 by design.
 */
import { M0_METHODS, PROTOCOL_VERSION, type ErrorCode } from '../shared/protocol';
import { probePi, type PiProbe, type SpawnFn } from './probe';

export class BridgeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export type Handler = (params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export interface HandlersContext {
  env: NodeJS.ProcessEnv;
  home: string;
  spawnFn?: SpawnFn;
  now?: () => number;
  testMode?: boolean;
  pid?: number;
}

export function makeHandlers(ctx: HandlersContext): Record<string, Handler> {
  const now = ctx.now ?? Date.now;
  const startedAt = now();
  let piCache: PiProbe | null | undefined;

  const pi = async (): Promise<PiProbe> => {
    if (piCache === undefined) {
      piCache = await probePi({ env: ctx.env, home: ctx.home, spawnFn: ctx.spawnFn });
    }
    if (!piCache) {
      throw new BridgeError(
        'PI_NOT_FOUND',
        'Pi executable not found (checked PI_WS_DESKTOP_PI, ~/.local/bin/pi and PATH)',
      );
    }
    return piCache;
  };

  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new BridgeError('CANCELLED', 'request cancelled'));
        },
        { once: true },
      );
    });

  const handlers: Record<string, Handler> = {
    health: async () => ({
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      uptimeMs: now() - startedAt,
      pid: ctx.pid ?? process.pid,
    }),
    ping: async () => ({ pong: true }),
    getRuntimeInfo: async () => {
      const p = await pi();
      return {
        distro: ctx.env.PI_WS_DESKTOP_DISTRO ?? null,
        node: { path: process.execPath, version: process.version },
        pi: p,
        agentDir: ctx.home ? `${ctx.home}/.pi/agent` : null,
      };
    },
    getCapabilities: async () => {
      const p = await pi();
      if (!p.rpcSupported) {
        throw new BridgeError(
          'PI_INCOMPATIBLE',
          `Pi ${p.version} does not advertise RPC mode (--mode rpc); bridge capability check failed`,
        );
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        methods: [...M0_METHODS],
        pi: { version: p.version, rpcSupported: p.rpcSupported },
      };
    },
  };

  if (ctx.testMode) {
    handlers.__test_slow = async (params, signal) => {
      const ms = Math.min(Number(params.ms ?? 200) || 0, 30_000);
      await sleep(ms, signal);
      return { sleptMs: ms, tag: params.tag ?? null };
    };
  }

  return handlers;
}
