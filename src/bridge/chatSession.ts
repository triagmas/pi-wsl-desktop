/**
 * Chat session lifecycle + CLI/GUI concurrency policy (M1, SPEC §3.3).
 *
 * The ONLY sanctioned write path: spawn the official Pi RPC
 * (`pi --mode rpc --session <file>`) with the session's project cwd — this
 * app NEVER writes JSONL itself, never forks, never re-sends a prompt after
 * an indeterminate result (fail-closed instead).
 *
 * Policies (each pinned by tests/unit/chatSession.test.ts):
 * - open:
 *   1. missing file            → SESSION_NOT_FOUND (nothing spawned);
 *   2. mtime within the window → SESSION_CONFLICT (a live CLI may be writing
 *      it — offer read-only preview / switch to CLI);
 *   3. a chat already open     → RESOURCE_BUSY (single slot);
 *   4. pi get_state failure    → BRIDGE_TIMEOUT + process killed (no zombie);
 *   5. pi reports another file → switch_session to the ORIGINAL path.
 * - sendPrompt (only from an explicit user action, via handlers/preload):
 *   - while IDLE, any file change since the last known idle mtime means an
 *     external writer → SESSION_CONFLICT and the prompt is NOT transmitted
 *     (no double generation);
 *   - Pi's own "Agent is streaming" rejection maps to RESOURCE_BUSY;
 *   - after acceptance, failures surface as `closed` events (teardown),
 *     never as a silent retry.
 * - crash: `closed(DISCONNECTED)` event, slot freed; reopen is explicit.
 * - user close: `closed(CANCELLED)` exactly once (exit duplicate suppressed
 *   by client identity, not flags).
 *
 * Bridge shutdown: when the bridge process exits, its stdio pipes close →
 * the child's stdin EOFs → Pi exits gracefully (verified shutdown contract).
 */
import { PiRpcClient, RpcCommandError, RpcDisconnectedError, RpcTimeoutError, type RpcProcess, type PiRpcClientOptions } from './piRpcClient';
import { buildProbePath } from './probe';
import { BridgeError } from '../shared/errors';
import type { ChatEventT, ModelInfoT, RpcStateT } from '../shared/m1Protocol';
import path from 'node:path';

export interface ChatManagerFs {
  stat(p: string): Promise<{ size: number; mtimeMs: number }>;
  readHead(p: string, maxBytes: number): Promise<string>;
  /** Bounded sequential read used to attribute appends after a mutation. */
  readRange(p: string, offset: number, length: number): Promise<Buffer>;
}

/**
 * UI26 R03: one spawned Pi RPC process = one immutable event source. `key`
 * starts empty and is filled only from Pi's own `get_state.sessionFile`; every
 * event is stamped from THIS record.
 */
interface Conn {
  client: PiRpcClient;
  key: string | null;
}

export interface ChatSessionManagerDeps {
  fs: ChatManagerFs;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Fixed clock for deterministic tests. */
  now?: () => number;
  activeWindowMs?: number;
  resolvePi: () => Promise<string | null>;
  spawnRpc: (o: { piPath: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }) => RpcProcess;
  onEvent?: (ev: ChatEventT) => void;
  rpcOptions?: Partial<PiRpcClientOptions>;
  headerMaxBytes?: number;
}

export function mapRpcState(raw: unknown): RpcStateT {
  const r = (raw ?? {}) as Record<string, unknown>;
  const model = r.model as { id?: unknown; name?: unknown; provider?: unknown } | undefined | null;
  return {
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : null,
    sessionFile: typeof r.sessionFile === 'string' ? r.sessionFile : null,
    isStreaming: r.isStreaming === true,
    isCompacting: r.isCompacting === true,
    messageCount: typeof r.messageCount === 'number' && r.messageCount >= 0 ? r.messageCount : 0,
    model:
      model && typeof model.id === 'string' && typeof model.name === 'string' && typeof model.provider === 'string'
        ? { id: model.id, name: model.name, provider: model.provider }
        : null,
    thinkingLevel: typeof r.thinkingLevel === 'string' ? r.thinkingLevel : null,
  };
}

/**
 * UI21-F2: project Pi's model record down to the credential-free shape the app
 * displays. Unknown/extra fields are dropped here, never forwarded to the
 * renderer — this app owns no catalog of its own.
 */
function mapModels(raw: unknown): ModelInfoT[] {
  const list = (raw as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  const out: ModelInfoT[] = [];
  for (const item of list) {
    const m = item as Record<string, unknown>;
    if (typeof m?.provider !== 'string' || typeof m.id !== 'string' || typeof m.name !== 'string') continue;
    const model: ModelInfoT = { provider: m.provider, id: m.id, name: m.name };
    if (typeof m.contextWindow === 'number' && m.contextWindow > 0) model.contextWindow = m.contextWindow;
    if (typeof m.maxTokens === 'number' && m.maxTokens > 0) model.maxTokens = m.maxTokens;
    if (typeof m.reasoning === 'boolean') model.reasoning = m.reasoning;
    if (Array.isArray(m.input)) model.input = m.input.filter((v): v is string => typeof v === 'string');
    out.push(model);
  }
  return out;
}

function mapThinkingLevels(raw: unknown): string[] {
  const levels = (raw as { levels?: unknown } | null)?.levels;
  return Array.isArray(levels) ? levels.filter((l): l is string => typeof l === 'string') : [];
}

async function readHeaderCwd(fs: ChatManagerFs, file: string, max: number): Promise<string | null> {
  try {
    const head = await fs.readHead(file, max);
    const nl = head.indexOf('\n');
    const line = nl === -1 ? head : head.slice(0, nl);
    const parsed = JSON.parse(line) as { cwd?: unknown };
    return typeof parsed.cwd === 'string' && parsed.cwd.startsWith('/') ? parsed.cwd : null;
  } catch {
    return null;
  }
}

export class ChatSessionManager {
  private client: PiRpcClient | null = null;
  private file: string | null = null;
  /**
   * UI26 R01: the conversation this manager is currently attached to, as the
   * renderer's session key (`file:<sessionFile>`). Every emitted event carries
   * it, so a late event of chat A can never be rendered inside chat B.
   * Set from Pi's `get_state.sessionFile` — never invented here.
   */
  private conn: Conn | null = null;
  /** Slot is being taken by `open`/`newSession` — set before the first await. */
  private opening = false;
  /** In-flight open/newSession, so `close()` can wait instead of orphaning it. */
  private openTask: Promise<unknown> | null = null;
  private idleMtimeMs = 0;
  private runActive = false;
  private readonly now: () => number;
  private readonly window: number;

  constructor(private readonly deps: ChatSessionManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.window = deps.activeWindowMs ?? 10_000;
  }

  get isOpen(): boolean {
    return this.client !== null && this.client.alive;
  }

  /**
   * UI26 R03: event provenance comes from the connection that produced it,
   * never from a mutable `this.key`. A late event of chat A therefore keeps
   * `file:A` even after B replaced it — it can never be re-stamped as B.
   * Events emitted before Pi reported a session file are DROPPED: an event
   * without a proven owner is not shown anywhere.
   */
  private emitFrom(conn: Conn, ev: ChatEventT): void {
    // UI26 R04 (P2): only the CURRENT connection may publish. A closed
    // connection can be replaced by a new one bound to the SAME `file:<path>`,
    // so a matching key is not enough — the generation must match too.
    if (this.conn !== conn) return;
    const key = conn.key;
    if (!key) return;
    this.deps.onEvent?.({ ...ev, key } as ChatEventT);
  }

  private emit(ev: ChatEventT): void {
    const conn = this.conn;
    if (!conn) return;
    this.emitFrom(conn, ev);
  }

  private async statOrThrow(file: string): Promise<{ size: number; mtimeMs: number }> {
    try {
      return await this.deps.fs.stat(file);
    } catch (err) {
      throw new BridgeError('SESSION_NOT_FOUND', `Session file not readable: ${file} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /**
   * UI26 R03 (P1-1): the single RPC slot is RESERVED synchronously, before the
   * first await. Two concurrent `open`/`newSession` calls can no longer both
   * pass the liveness check and spawn two Pi processes.
   */
  private async withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.opening) {
      throw new BridgeError('RESOURCE_BUSY', 'Диалог уже создаётся — дождитесь ответа Pi');
    }
    if (this.client?.alive) {
      throw new BridgeError('RESOURCE_BUSY', 'Диалог уже открыт — закройте его перед открытием другого');
    }
    this.opening = true;
    this.client = null; // stale dead handle (exit event not yet observed)
    const task = run();
    this.openTask = task;
    try {
      return await task;
    } finally {
      if (this.openTask === task) this.openTask = null;
      this.opening = false;
    }
  }

  async open(file: string): Promise<RpcStateT | null> {
    return this.withSlot(() => this.openInner(file));
  }

  private async openInner(file: string): Promise<RpcStateT | null> {
    if (this.client) {
      if (this.client.alive) {
        throw new BridgeError('RESOURCE_BUSY', 'A chat session is already open — close it before opening another');
      }
      this.client = null; // stale dead handle (exit event not yet observed)
    }

    const meta = await this.statOrThrow(file);
    if (this.now() - meta.mtimeMs <= this.window) {
      throw new BridgeError(
        'SESSION_CONFLICT',
        'Session was modified within the active window — a CLI may be writing it. Open a read-only preview or switch to the CLI.',
      );
    }

    const piPath = await this.deps.resolvePi();
    if (!piPath) throw new BridgeError('PI_NOT_FOUND', 'Pi executable not found for chat spawn');
    const cwd = (await readHeaderCwd(this.deps.fs, file, this.deps.headerMaxBytes ?? 64 * 1024)) ?? path.posix.dirname(file);

    let conn: Conn | null = null;
    const client = new PiRpcClient({
      spawn: () =>
        this.deps.spawnRpc({
          piPath,
          args: ['--mode', 'rpc', '--session', file],
          cwd,
          env: { ...this.deps.env, PATH: buildProbePath(this.deps.home) },
        }),
      ...this.deps.rpcOptions,
      onEvent: (name, record) => {
        if (conn) this.emitFrom(conn, { kind: 'pi', name, data: record });
      },
      onExit: () => {
        if (!conn || this.conn !== conn) return;
        const key = conn.key;
        this.conn = null;
        this.client = null;
        this.file = null;
        this.runActive = false;
        this.deps.onEvent?.({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited', ...(key ? { key } : {}) });
      },
    });
    conn = { client, key: null };
    client.connect();

    let state: RpcStateT;
    try {
      const raw = await client.request('get_state');
      state = mapRpcState(raw);
      if (state.sessionFile !== file) {
        await client.request('switch_session', { sessionPath: file });
        state = mapRpcState(await client.request('get_state'));
        if (state.sessionFile !== file) {
          throw new BridgeError('SESSION_CONFLICT', `Pi did not switch to the requested session (${state.sessionFile ?? 'none'})`);
        }
      }
    } catch (err) {
      // Teardown BEFORE rethrow: a failed open must never leave a zombie RPC
      // process behind (kill fallback is bounded by exitWaitMs).
      await client.close().catch(() => undefined);
      if (err instanceof BridgeError) throw err;
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcCommandError) throw new BridgeError('SESSION_CONFLICT', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('BRIDGE_TIMEOUT', `Pi RPC exited during open: ${err.message}`);
      throw new BridgeError('BRIDGE_TIMEOUT', err instanceof Error ? err.message : String(err));
    }

    this.client = client;
    this.file = file;
    this.conn = conn;
    conn.key = `file:${file}`;
    this.runActive = false;
    // After the initial load (which may legitimately rewrite legacy files via
    // the official API), snapshot the idle baseline.
    const post = await this.statOrThrow(file).catch(() => meta);
    this.idleMtimeMs = post.mtimeMs;
    this.emitFrom(conn, { kind: 'opened', state });
    return state;
  }

  /**
   * UI26 R01 — «Новый диалог» через официальный Pi RPC.
   *
   * Spawns `pi --mode rpc` in the project cwd (no `--session`) and issues
   * `new_session`. Pi 1.4.0 does NOT materialize the JSONL at this point — the
   * file appears on the first write. That is exactly the contract we want:
   * a draft that costs nothing until the user really sends something. The
   * bridge never writes a JSONL itself and never invents a session.
   */
  async newSession(cwd: string): Promise<{ state: RpcStateT; sessionFile: string }> {
    return this.withSlot(() => this.newSessionInner(cwd));
  }

  private async newSessionInner(cwd: string): Promise<{ state: RpcStateT; sessionFile: string }> {

    const piPath = await this.deps.resolvePi();
    if (!piPath) throw new BridgeError('PI_NOT_FOUND', 'Pi executable not found for chat spawn');

    let conn: Conn | null = null;
    const client = new PiRpcClient({
      spawn: () =>
        this.deps.spawnRpc({
          piPath,
          args: ['--mode', 'rpc'],
          cwd,
          env: { ...this.deps.env, PATH: buildProbePath(this.deps.home) },
        }),
      ...this.deps.rpcOptions,
      onEvent: (name, record) => {
        if (conn) this.emitFrom(conn, { kind: 'pi', name, data: record });
      },
      onExit: () => {
        if (!conn || this.conn !== conn) return;
        const key = conn.key;
        this.conn = null;
        this.client = null;
        this.file = null;
        this.runActive = false;
        this.deps.onEvent?.({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited', ...(key ? { key } : {}) });
      },
    });
    conn = { client, key: null };
    client.connect();

    let state: RpcStateT;
    try {
      // 1) confirm the RPC handshake, 2) ask Pi for a fresh session — the
      // official command (an extension may cancel it; that is not a session).
      await client.request('get_state');
      const created = await client.request('new_session');
      const cancelled = (created as { cancelled?: unknown } | null)?.cancelled === true;
      if (cancelled) {
        throw new BridgeError('SESSION_CONFLICT', 'Pi отклонил создание новой сессии (расширение отменило new_session)');
      }
      state = mapRpcState(await client.request('get_state'));
      if (!state.sessionFile) {
        throw new BridgeError('SESSION_CONFLICT', 'Pi не назначил файл новой сессии — создание отменено');
      }
    } catch (err) {
      await client.close().catch(() => undefined);
      if (err instanceof BridgeError) throw err;
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcCommandError) throw new BridgeError('SESSION_CONFLICT', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('BRIDGE_TIMEOUT', `Pi RPC exited during newSession: ${err.message}`);
      throw new BridgeError('UNKNOWN', err instanceof Error ? err.message : String(err));
    }

    this.client = client;
    this.file = state.sessionFile;
    this.conn = conn;
    conn.key = `file:${state.sessionFile}`;
    this.runActive = false;
    // The file does not exist yet; a baseline of 0 means "nothing to compare",
    // and the writer gate below skips the stat while the file is absent.
    this.idleMtimeMs = 0;
    this.emitFrom(conn, { kind: 'opened', state });
    return { state, sessionFile: state.sessionFile };
  }

  async sendPrompt(
    message: string,
    streamingBehavior?: 'steer' | 'followUp',
  ): Promise<{ disposition: string; sessionFile: string | null; sessionId: string | null; materialized: boolean }> {
    return this.serialize(async () => this.sendPromptLocked(message, streamingBehavior));
  }

  private async sendPromptLocked(
    message: string,
    streamingBehavior?: 'steer' | 'followUp',
  ): Promise<{ disposition: string; sessionFile: string | null; sessionId: string | null; materialized: boolean }> {
    const client = this.client;
    const conn = this.conn;
    if (!client || !client.alive || !this.file) {
      throw new BridgeError('DISCONNECTED', 'No chat session is open');
    }

    // Same fail-closed writer gate the model/thinking switches use.
    await this.assertIdleWriterGate('отправки сообщения');

    let started;
    try {
      started = await client.startPrompt(message, streamingBehavior ? { streamingBehavior } : {});
    } catch (err) {
      if (err instanceof RpcCommandError) {
        const busy = /streamingBehavior|already streaming/i.test(err.message);
        throw new BridgeError(busy ? 'RESOURCE_BUSY' : 'INVALID_REQUEST', err.message);
      }
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('DISCONNECTED', err.message);
      throw err;
    }

    this.runActive = true;
    const file = this.file;
    void started.run.then(
      () => {
        this.runActive = false;
        // Our own append is absorbed: refresh the idle baseline.
        void this.deps.fs
          .stat(file)
          .then((m) => {
            if (this.file === file) this.idleMtimeMs = m.mtimeMs;
          })
          .catch(() => undefined);
      },
      (err: unknown) => {
        this.runActive = false;
        if (this.client !== client) return; // exit path already emitted closed
        const code =
          err instanceof RpcTimeoutError ? 'BRIDGE_TIMEOUT' : err instanceof RpcDisconnectedError ? 'DISCONNECTED' : 'UNKNOWN';
        const message = err instanceof Error ? err.message : String(err);
        this.client = null;
        this.file = null;
        void client.close().catch(() => undefined);
        if (conn) this.emitFrom(conn, { kind: 'closed', code, message });
        if (this.conn === conn) this.conn = null;
      },
    );
    // UI26 R01: report the concrete session Pi is writing to, plus whether the
    // JSONL exists yet (Pi materializes it on the first write). The renderer
    // binds its draft to this file — the bridge never guesses a path.
    const materialized = await this.fileExists(file);
    const current = await this.getState().catch(() => ({ state: null as RpcStateT | null }));
    return {
      disposition: started.disposition,
      sessionFile: file,
      sessionId: current.state?.sessionId ?? null,
      materialized,
    };
  }

  /** True when the session file is on disk right now (read-only stat). */
  private async fileExists(file: string): Promise<boolean> {
    try {
      await this.deps.fs.stat(file);
      return true;
    } catch {
      return false;
    }
  }

  async interrupt(): Promise<{ interrupted: boolean }> {
    const client = this.client;
    if (!client || !client.alive) {
      throw new BridgeError('DISCONNECTED', 'No chat session is open');
    }
    try {
      await client.interrupt();
      return { interrupted: true };
    } catch (err) {
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('DISCONNECTED', err.message);
      throw err;
    }
  }

  /**
   * UI21-F2: the model list is whatever the installed Pi reports for the active
   * session's environment — no static list, no provider defaults, no fallback.
   */
  /**
   * UI21 R02: every mutating operation (prompt, model switch, thinking switch,
   * close) is serialized, so a check → RPC → baseline refresh sequence cannot
   * interleave with another mutation from this bridge.
   */
  private mutationChain: Promise<unknown> = Promise.resolve();

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(op, op);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Fail-closed idle external-writer gate, shared by prompt and switches.
   * While OUR run owns the file the gate is inert; otherwise any mtime newer
   * than the confirmed idle baseline means another writer (CLI) is active.
   */
  private async assertIdleWriterGate(action: string): Promise<{ size: number; mtimeMs: number }> {
    if (!this.file) throw new BridgeError('DISCONNECTED', 'No chat session is open');
    // UI26 R01: a brand-new session (new_session) has no file yet — there is no
    // external writer to detect and nothing to compare, so the gate lets the
    // first prompt through. Once the file exists the normal gate applies.
    if (!(await this.fileExists(this.file))) return { size: 0, mtimeMs: 0 };
    const meta = await this.statOrThrow(this.file);
    if (!this.runActive && meta.mtimeMs > this.idleMtimeMs) {
      throw new BridgeError(
        'SESSION_CONFLICT',
        `Session file changed while the chat was idle — another writer (CLI?) appended to it. Reload the history before ${action}.`,
      );
    }
    return meta;
  }

  /**
   * Attribute the bytes appended during our own mutation. Only an EXACT,
   * expected Pi-owned record sequence may advance the idle baseline; anything
   * else means a concurrent writer raced us, so we fail closed — without
   * truncating, rewriting or absorbing the foreign record.
   */
  private async confirmOwnAppend(
    before: { size: number },
    validate: (entries: Record<string, unknown>[]) => boolean,
  ): Promise<void> {
    const file = this.file;
    if (!file) throw new BridgeError('DISCONNECTED', 'No chat session is open');
    const meta = await this.statOrThrow(file);
    if (meta.size < before.size) {
      throw new BridgeError('SESSION_CONFLICT', 'Session file was truncated or rewritten during the switch');
    }
    if (meta.size === before.size) {
      // Pi persisted nothing (e.g. no-op switch) — nothing to attribute.
      this.idleMtimeMs = meta.mtimeMs;
      return;
    }
    const added = meta.size - before.size;
    if (added > 64 * 1024) {
      throw new BridgeError('SESSION_CONFLICT', `Unexpected ${added} bytes appended during the switch`);
    }
    const raw = await this.deps.fs.readRange(file, before.size, added);
    const lines = raw
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const entries: Record<string, unknown>[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new BridgeError('SESSION_CONFLICT', 'Unexpected record appended during the switch');
        }
        entries.push(parsed as Record<string, unknown>);
      } catch {
        throw new BridgeError('SESSION_CONFLICT', 'Unparsable record appended during the switch');
      }
    }
    if (!validate(entries)) {
      throw new BridgeError('SESSION_CONFLICT', 'Another writer appended to the session during the switch');
    }
    this.idleMtimeMs = meta.mtimeMs;
  }

  async availableModels(): Promise<{ models: ModelInfoT[] }> {
    const client = this.liveClient();
    try {
      return { models: mapModels(await client.request('get_available_models')) };
    } catch (err) {
      throw this.mapCommandError(err, 'get_available_models');
    }
  }

  /** Explicit user switch only. Rejects while a run is in flight (no silent swap). */
  async setModel(provider: string, modelId: string): Promise<{ state: RpcStateT | null }> {
    return this.serialize(async () => {
      const client = this.liveClient();
      if (this.runActive) {
        throw new BridgeError('RESOURCE_BUSY', 'Модель нельзя менять во время генерации');
      }
      // Fail closed BEFORE any mutation if another writer touched the file.
      const before = await this.assertIdleWriterGate('смены модели');
      // Pre-state gives the effective thinking level BEFORE the switch: native Pi
      // appends a second record only when that level actually changes.
      const preState = mapRpcState(await client.request('get_state'));
      try {
        await client.request('set_model', { provider, modelId });
      } catch (err) {
        throw this.mapCommandError(err, 'set_model');
      }
      const state = mapRpcState(await client.request('get_state'));
      // Strict confirmation: an ACK alone is not proof.
      if (state.model === null || state.model.provider !== provider || state.model.id !== modelId) {
        const current = state.model ? `${state.model.provider}/${state.model.id}` : 'модель не подтверждена';
        throw new BridgeError('INVALID_REQUEST', `Pi не переключил модель (сейчас ${current})`);
      }
      // Native Pi 1.4.0 writes `model_change` and then, when the effective
      // thinking level changes (e.g. a non-reasoning model forces "off"),
      // a second `thinking_level_change`. Accept exactly that ordered pair and
      // nothing else — any extra/foreign record still fails closed.
      const levelChanged = preState.thinkingLevel !== state.thinkingLevel;
      await this.confirmOwnAppend(before, (entries) => {
        if (entries.length === 0) return true;
        if (entries.length > 2) return false;
        const [first, second] = entries;
        if (first?.type !== 'model_change' || first.provider !== provider || first.modelId !== modelId) return false;
        if (entries.length === 1) return true;
        return (
          levelChanged &&
          second?.type === 'thinking_level_change' &&
          second.thinkingLevel === state.thinkingLevel
        );
      });
      return { state };
    });
  }

  /** Supported thinking levels for the CURRENTLY selected model, straight from Pi. */
  async thinkingLevels(): Promise<{ levels: string[]; current: string | null }> {
    const client = this.liveClient();
    try {
      const levels = mapThinkingLevels(await client.request('get_available_thinking_levels'));
      const state = mapRpcState(await client.request('get_state'));
      return { levels, current: state.thinkingLevel };
    } catch (err) {
      throw this.mapCommandError(err, 'get_available_thinking_levels');
    }
  }

  async setThinkingLevel(level: string): Promise<{ state: RpcStateT | null }> {
    return this.serialize(async () => {
      const client = this.liveClient();
      if (this.runActive) {
        throw new BridgeError('RESOURCE_BUSY', 'Уровень thinking нельзя менять во время генерации');
      }
      const before = await this.assertIdleWriterGate('смены уровня thinking');
      try {
        await client.request('set_thinking_level', { level });
      } catch (err) {
        throw this.mapCommandError(err, 'set_thinking_level');
      }
      const state = mapRpcState(await client.request('get_state'));
      if (state.thinkingLevel !== level) {
        throw new BridgeError('INVALID_REQUEST', `Pi не установил thinking level (сейчас ${state.thinkingLevel ?? 'не подтверждён'})`);
      }
      await this.confirmOwnAppend(
        before,
        (entries) =>
          entries.length === 0 ||
          (entries.length === 1 && entries[0]?.type === 'thinking_level_change' && entries[0].thinkingLevel === level),
      );
      return { state };
    });
  }

  private liveClient(): PiRpcClient {
    const client = this.client;
    if (!client || !client.alive) {
      throw new BridgeError('DISCONNECTED', 'Нет активной RPC-сессии Pi — откройте чат');
    }
    return client;
  }

  private mapCommandError(err: unknown, command: string): BridgeError {
    if (err instanceof RpcTimeoutError) return new BridgeError('BRIDGE_TIMEOUT', err.message);
    if (err instanceof RpcDisconnectedError) return new BridgeError('DISCONNECTED', err.message);
    // Pi answered success:false (unknown model/level, unsupported) — surface it,
    // never fall back to a different model silently.
    if (err instanceof RpcCommandError) return new BridgeError('INVALID_REQUEST', `${command}: ${err.message}`);
    if (err instanceof BridgeError) return err;
    return new BridgeError('UNKNOWN', err instanceof Error ? err.message : String(err));
  }

  async getState(): Promise<{ state: RpcStateT | null; sessionFileExists: boolean }> {
    const client = this.client;
    if (!client || !client.alive) return { state: null, sessionFileExists: false };
    try {
      const state = mapRpcState(await client.request('get_state'));
      // UI26 R03 (P1-3): Pi may materialize the JSONL only after the prompt ACK.
      // We report the REAL fact from disk (read-only stat) — never a guess, and
      // the bridge never writes the file itself.
      const sessionFileExists = state.sessionFile ? await this.fileExists(state.sessionFile) : false;
      return { state, sessionFileExists };
    } catch (err) {
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('DISCONNECTED', err.message);
      throw err;
    }
  }

  async close(): Promise<void> {
    return this.serialize(async () => {
      // UI26 R03: closing during an in-flight open must not leave an orphan Pi
      // process — wait for that attempt to settle, then tear the slot down.
      if (this.openTask) await this.openTask.catch(() => undefined);
      return this.closeLocked();
    });
  }

  private async closeLocked(): Promise<void> {
    const client = this.client;
    const key = this.conn?.key ?? null;
    this.client = null;
    this.file = null;
    this.conn = null;
    this.runActive = false;
    if (!client) return;
    await client.close().catch(() => undefined);
    this.deps.onEvent?.({ kind: 'closed', code: 'CANCELLED', message: 'chat closed by user', ...(key ? { key } : {}) });
  }
}
