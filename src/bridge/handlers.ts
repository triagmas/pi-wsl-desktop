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
import {
  ApplyResourceOpParamsSchema,
  ApplyResourceOpResultSchema,
  ListMcpServersResultSchema,
  ListPackagesResultSchema,
  ListSkillsResultSchema,
  PreviewResourceOpParamsSchema,
  PreviewResourceOpResultSchema,
  RollbackResourceOpParamsSchema,
  RollbackResourceOpResultSchema,
} from '../shared/m2Protocol';
import {
  ListModulesParamsSchema,
  ListModulesResultSchema,
  MAX_MODULE_DIAGNOSTICS,
  SetModuleStateParamsSchema,
  SetModuleStateResultSchema,
} from '../shared/m3Ipc';
import { discoverModules, readModuleState, writeModuleState } from './modules';
import { probePi, type PiProbe, type SpawnFn } from './probe';
import { buildSessionIndex, inodeMatches, nodeFs, resolveSessionRoots, type FsLike } from './sessions';
import { readSessionFile } from './sessionReader';
import { searchSessions } from './search';
import { ChatSessionManager } from './chatSession';
import { loadAgentConfig, type AgentConfig } from './resources/agentConfig';
import { discoverMcp } from './resources/mcp';
import { ResourceOps } from './resources/ops';
import { discoverPackages } from './resources/packages';
import { discoverSkills } from './resources/skills';
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

  /* --------------------------- M2 resource manager -------------------------- */
  // Isolated resource home/cwd (tests + E2E override; production falls back
  // to the bridge's real HOME/cwd). Read-only config loads are cached for
  // the bridge lifetime; ops run the documented Pi CLI, never raw writes.
  const resourceHome = ctx.env.PI_WS_DESKTOP_AGENT_HOME ?? ctx.home;
  const resourceCwd = ctx.env.PI_WS_DESKTOP_AGENT_CWD ?? process.cwd();
  const resourceAgentDir = path.posix.join(resourceHome, '.pi', 'agent');
  let cfgCache: Promise<AgentConfig> | null = null;
  const resourceCfg = (): Promise<AgentConfig> =>
    (cfgCache ??= loadAgentConfig({ fs: nodeFs, home: resourceHome, cwd: resourceCwd }));
  const resolveCli = async (): Promise<string> => {
    const explicit = ctx.env.PI_WS_DESKTOP_RESOURCE_CLI ?? ctx.env.PI_WS_DESKTOP_PI;
    if (explicit) return explicit;
    const local = path.posix.join(resourceHome, '.local', 'bin', 'pi');
    try {
      await fsp.stat(local);
      return local;
    } catch {
      return 'pi'; // PATH lookup (same fallback the probe uses)
    }
  };
  let opsCache: ResourceOps | null = null;
  const resourceOps = async (): Promise<ResourceOps> => {
    if (opsCache) return opsCache;
    const cfg = await resourceCfg();
    opsCache = new ResourceOps({
      home: resourceHome,
      agentDir: resourceAgentDir,
      projectPiDir: cfg.projectTrusted ? path.posix.join(cfg.projectRoot, '.pi') : undefined,
      cliPath: await resolveCli(),
    });
    return opsCache;
  };

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
      await handle.close().catch(() => undefined); // R1d: never mask the original error
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
        await opened.handle.close().catch(() => undefined); // R1d: keep the original error
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
        // Canonicalization removed the symlinks that existed AT validation;
        // the dev/ino recheck below additionally catches a rename/symlink swap
        // between validation and spawn (maps to SESSION_CONFLICT). Full
        // atomicity is impossible with path-based `pi --session` — the
        // residual microsecond TOCTOU is documented in the PR/ROADMAP risk
        // list and requires write access to the session directory anyway.
        if (!(await inodeMatches(opened.handle, opened.canonical))) {
          throw new BridgeError('SESSION_CONFLICT', 'session file changed on disk before opening');
        }
        // Pi owns writes through official RPC, not through this handle.
        const state = await getChat().open(opened.canonical);
        return assertOut(OpenSessionResultSchema, { state }, 'openSession');
      } finally {
        await opened.handle.close().catch(() => undefined); // R1d: keep the original error
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

    /* --------------------------- M2 resource manager ------------------------ */
    listSkills: async () => {
      const cfg = await resourceCfg();
      const pkgs = await discoverPackages({ fs: nodeFs, cfg });
      const r = await discoverSkills({ fs: nodeFs, cfg, packageDirs: pkgs.packageDirs });
      return assertOut(ListSkillsResultSchema, { skills: r.skills, diagnostics: r.diagnostics.slice(0, 50) }, 'listSkills');
    },
    listPackages: async () => {
      const cfg = await resourceCfg();
      const r = await discoverPackages({ fs: nodeFs, cfg });
      return assertOut(
        ListPackagesResultSchema,
        {
          packages: r.packages,
          builtins: r.builtins,
          settingsExtensions: r.settingsExtensions.slice(0, 200),
          diagnostics: r.diagnostics.slice(0, 50),
        },
        'listPackages',
      );
    },
    listMcpServers: async () => {
      const cfg = await resourceCfg();
      const r = await discoverMcp({ fs: nodeFs, cfg });
      return assertOut(
        ListMcpServersResultSchema,
        { servers: r.servers, builtinEnabled: r.builtinEnabled, logDiagnostics: r.logDiagnostics, diagnostics: r.diagnostics.slice(0, 50) },
        'listMcpServers',
      );
    },
    previewResourceOp: async (params) => {
      const p = parseParams(PreviewResourceOpParamsSchema, params, 'previewResourceOp');
      const { plan } = await (await resourceOps()).preview(p);
      return assertOut(PreviewResourceOpResultSchema, { plan }, 'previewResourceOp');
    },
    applyResourceOp: async (params) => {
      const p = parseParams(ApplyResourceOpParamsSchema, params, 'applyResourceOp');
      const ops = await resourceOps();
      try {
        return assertOut(ApplyResourceOpResultSchema, await ops.apply(p.planId, p.confirm), 'applyResourceOp');
      } finally {
        // Any attempt may have rewritten settings/mcp.json — drop the cached
        // config so the next inventory read reflects the new state (the E2E
        // write cycle caught stale `excluded` badges without this).
        cfgCache = null;
      }
    },
    rollbackResourceOp: async (params) => {
      const p = parseParams(RollbackResourceOpParamsSchema, params, 'rollbackResourceOp');
      const ops = await resourceOps();
      try {
        return assertOut(RollbackResourceOpResultSchema, await ops.rollback(p.opId, p.confirm), 'rollbackResourceOp');
      } finally {
        cfgCache = null; // restored bytes change the inventory too
      }
    },

    /* ----------------------- M3 read path: discovery ---------------------- */
    listModules: async (params) => {
      // No caller-supplied path: params must be exactly {}. The root, size,
      // symlink and encoding guards live in discoverModules (bridge-owned).
      parseParams(ListModulesParamsSchema, params ?? {}, 'listModules');
      const discovered = await discoverModules(ctx.home);
      const stateRead = await readModuleState(ctx.home);
      return assertOut(
        ListModulesResultSchema,
        {
          ...discovered,
          state: stateRead.state,
          diagnostics: [...discovered.diagnostics, ...stateRead.diagnostics]
            .slice(0, MAX_MODULE_DIAGNOSTICS),
        },
        'listModules',
      );
    },

    /* ---------------------- M3 write boundary: state ---------------------- */
    setModuleState: async (params) => {
      // Desktop app state only ($HOME/.pi-desktop, never ~/.pi): strict
      // {id, enabled}; the bridge re-validates guards and writes atomically.
      const p = parseParams(SetModuleStateParamsSchema, params, 'setModuleState');
      return assertOut(
        SetModuleStateResultSchema,
        await writeModuleState(ctx.home, p.id, p.enabled),
        'setModuleState',
      );
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
