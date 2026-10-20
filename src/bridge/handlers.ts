/**
 * Bridge method handlers — M0 read-only diagnostics + M1 Sessions & Chat.
 *
 * Read paths (list/read/search) only scan and parse session files: bounded,
 * read-only, never routed through Pi's migration-capable loader.
 *
 * Write boundary: `openSession` / `sendPrompt` / `interrupt` / `closeSession`
 * are reachable ONLY from the renderer allowlist (explicit user gestures) and
 * are re-gated here by ChatSessionManager policy — SESSION_CONFLICT,
 * SESSION_NOT_FOUND, RESOURCE_BUSY — with the official Pi RPC subprocess as
 * the sole writer (`--session <file>`; this process never writes JSONL).
 * Chat events are pushed as bridge `event` frames ONLY after
 * `subscribeEvents {topic:'chat'}`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { ALL_METHODS, PROTOCOL_VERSION } from '../shared/protocol';
import { BridgeError } from '../shared/errors';
import {
  CloseSessionResultSchema,
  GetStateResultSchema,
  InterruptResultSchema,
  ListProjectsResultSchema,
  ListSessionsParamsSchema,
  ListSessionsResultSchema,
  OpenSessionParamsSchema,
  OpenSessionResultSchema,
  ReadSessionParamsSchema,
  ReadSessionResultSchema,
  SearchParamsSchema,
  SearchResultSchema,
  SendPromptParamsSchema,
  SubscribeParamsSchema,
} from '../shared/m1Protocol';
import { probePi, type PiProbe, type SpawnFn } from './probe';
import { buildSessionIndex, nodeFs, resolveSessionRoots, type FsLike } from './sessions';
import { readSessionFile } from './sessionReader';
import { searchSessions } from './search';
import { ChatSessionManager } from './chatSession';
import type { RpcProcess } from './piRpcClient';
import type { ZodType } from 'zod';

export { BridgeError };

export type Handler = (params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export interface HandlersContext {
  env: NodeJS.ProcessEnv;
  home: string;
  spawnFn?: SpawnFn;
  now?: () => number;
  testMode?: boolean;
  pid?: number;
  /** Wired by the bridge entrypoint: pushes an event frame to the client. */
  emitEvent?: (event: string, payload: unknown) => void;
}

function parseParams<T>(schema: ZodType<T>, data: unknown, method: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new BridgeError('INVALID_REQUEST', `${method}: ${detail}`);
  }
  return r.data;
}

function assertOut<T>(schema: ZodType<T>, value: T, method: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new BridgeError('UNKNOWN', `${method}: internal contract violation (${r.error.issues[0]?.message ?? 'invalid result'})`);
  }
  return r.data;
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

  /* ---------------- M1 chat: single manager + subscription gate ------------ */
  const subscriptions = { chat: false };
  let chat: ChatSessionManager | null = null;
  const getChat = (): ChatSessionManager => {
    if (!chat) {
      // Test/CI control of the active-write gate: PI_WS_DESKTOP_ACTIVE_WINDOW_MS
      // (0 disables — used by deterministic E2E; production default stays 10s).
      const activeWindow = Number(ctx.env.PI_WS_DESKTOP_ACTIVE_WINDOW_MS);
      chat = new ChatSessionManager({
        fs: nodeFs,
        home: ctx.home,
        env: ctx.env,
        ...(Number.isFinite(activeWindow) && ctx.env.PI_WS_DESKTOP_ACTIVE_WINDOW_MS !== undefined
          ? { activeWindowMs: Math.max(0, activeWindow) }
          : {}),
        resolvePi: async () => (await pi()).path,
        spawnRpc: ({ piPath, args, cwd, env }): RpcProcess =>
          spawn(piPath, args, { cwd, env, stdio: 'pipe' }),
        onEvent: (ev) => {
          if (subscriptions.chat) ctx.emitEvent?.('chat', ev);
        },
      });
    }
    return chat;
  };

  const index = (): ReturnType<typeof buildSessionIndex> =>
    buildSessionIndex({ fs: nodeFs, env: ctx.env, home: ctx.home, now: now() });

  /** A component-safe containment check ("/root" must not match "/root-other"). */
  const inside = (root: string, target: string): boolean => {
    const relative = path.posix.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative));
  };

  /**
   * Validate the *opened inode*, not merely a pathname that might be a
   * symlink. WSL/Linux /proc/self/fd keeps the target stable while a renderer
   * read is in progress, even if a directory entry is retargeted afterward.
   * Do not read bytes or start Pi until its canonical location is trusted.
   */
  const openInsideRoots = async (file: string): Promise<{ handle: FileHandle; canonical: string } | null> => {
    const { roots } = await resolveSessionRoots({ fs: nodeFs, env: ctx.env, home: ctx.home });
    const requested = path.posix.resolve(file);
    if (!roots.some((root) => inside(path.posix.resolve(root), requested))) {
      throw new BridgeError('INVALID_REQUEST', 'file is outside the session roots');
    }

    let handle: FileHandle;
    try {
      // NONBLOCK avoids a hang if an untrusted directory contains a FIFO.
      handle = await fsp.open(file, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new BridgeError('SESSION_NOT_FOUND', 'Session file could not be opened');
    }

    try {
      if (!(await handle.stat()).isFile()) {
        throw new BridgeError('INVALID_REQUEST', 'session path is not a regular file');
      }
      const canonical = await fsp.realpath(`/proc/self/fd/${handle.fd}`);
      const canonicalRoots = await Promise.all(roots.map((root) => fsp.realpath(root)));
      if (!canonicalRoots.some((root) => inside(root, canonical))) {
        throw new BridgeError('INVALID_REQUEST', 'file is outside the session roots');
      }
      return { handle, canonical };
    } catch (error) {
      await handle.close();
      if (error instanceof BridgeError) throw error;
      // Cannot prove the inode's origin: fail closed.
      throw new BridgeError('INVALID_REQUEST', 'session path could not be verified');
    }
  };

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
        methods: [...ALL_METHODS],
        pi: { version: p.version, rpcSupported: p.rpcSupported },
      };
    },

    /* ----------------------------- M1 read paths ---------------------------- */
    listProjects: async () => {
      const idx = await index();
      return assertOut(
        ListProjectsResultSchema,
        { projects: idx.projects, diagnostics: idx.diagnostics.slice(0, 50) },
        'listProjects',
      );
    },
    listSessions: async (params) => {
      const { projectId } = parseParams(ListSessionsParamsSchema, params, 'listSessions');
      const idx = await index();
      const sessions = projectId === undefined ? idx.sessions : idx.sessions.filter((s) => s.projectId === projectId);
      return assertOut(
        ListSessionsResultSchema,
        { sessions, diagnostics: idx.diagnostics.slice(0, 50) },
        'listSessions',
      );
    },
    readSession: async (params) => {
      const p = parseParams(ReadSessionParamsSchema, params, 'readSession');
      const opened = await openInsideRoots(p.file);
      if (!opened) {
        // The pathname disappeared before it could be opened. Never retry
        // the unchecked path: it could be retargeted to an outside file.
        return assertOut(ReadSessionResultSchema, {
          header: null, entries: [], leafId: null, nextCursor: null,
          truncated: false, partialTrailing: false, diagnostics: [],
          availability: 'unreadable' as const,
        }, 'readSession');
      }
      try {
        // All reads use a single validated descriptor. Never re-open the
        // original user-controlled symlink between JSONL chunks.
        const pinnedFs: FsLike = {
          ...nodeFs,
          async stat() {
            const s = await opened.handle.stat();
            return { size: s.size, mtimeMs: s.mtimeMs };
          },
          async readRange(_file, offset, length) {
            const buf = Buffer.alloc(length);
            const { bytesRead } = await opened.handle.read(buf, 0, length, offset);
            return Buffer.from(buf.subarray(0, bytesRead));
          },
        };
        const result = await readSessionFile({ fs: pinnedFs, ...p, file: opened.canonical });
        return assertOut(ReadSessionResultSchema, result, 'readSession');
      } finally {
        await opened.handle.close();
      }
    },
    searchSessions: async (params) => {
      const p = parseParams(SearchParamsSchema, params, 'searchSessions');
      const idx = await index();
      const result = await searchSessions({
        fs: nodeFs,
        index: idx,
        query: p.query,
        projectId: p.projectId,
        includeContent: p.includeContent,
      });
      return assertOut(SearchResultSchema, result, 'searchSessions');
    },

    /* ---------------------------- M1 write path ----------------------------- */
    subscribeEvents: async (params) => {
      const { topic } = parseParams(SubscribeParamsSchema, params, 'subscribeEvents');
      if (topic !== 'chat') throw new BridgeError('INVALID_REQUEST', `unknown topic: ${String(topic)}`);
      subscriptions.chat = true;
      return { subscribed: true };
    },
    openSession: async (params) => {
      const { file } = parseParams(OpenSessionParamsSchema, params, 'openSession');
      const opened = await openInsideRoots(file);
      if (!opened) throw new BridgeError('SESSION_NOT_FOUND', 'Session file not found');
      try {
        // Canonical path prevents a symlink being redirected after validation.
        // Pi owns writes through official RPC, not through this handle.
        const state = await getChat().open(opened.canonical);
        return assertOut(OpenSessionResultSchema, { state }, 'openSession');
      } finally {
        await opened.handle.close();
      }
    },
    sendPrompt: async (params) => {
      const p = parseParams(SendPromptParamsSchema, params, 'sendPrompt');
      const { disposition } = await getChat().sendPrompt(p.message, p.streamingBehavior);
      return { disposition };
    },
    interrupt: async () => assertOut(InterruptResultSchema, await getChat().interrupt(), 'interrupt'),
    getState: async () => assertOut(GetStateResultSchema, await getChat().getState(), 'getState'),
    closeSession: async () => {
      await getChat().close();
      return assertOut(CloseSessionResultSchema, { closed: true }, 'closeSession');
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
