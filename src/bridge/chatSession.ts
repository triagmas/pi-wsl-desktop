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
import type { ChatEventT, RpcStateT } from '../shared/m1Protocol';
import path from 'node:path';

export interface ChatManagerFs {
  stat(p: string): Promise<{ size: number; mtimeMs: number }>;
  readHead(p: string, maxBytes: number): Promise<string>;
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

/** Durable display name queued for a created session (R03 п.2): Pi accepts
 * it via `set_session_name` and persists it with the first flushed message
 * (session-manager appendSessionInfo → _persist → _hasConversation —
 * source-verified); if the session never gets a message, no file exists and
 * the name is never claimed anywhere. */
export const NEW_DIALOG_NAME = 'Новый диалог';

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
  private idleMtimeMs = 0;
  private runActive = false;
  /** True from create() until the first run materializes the file on disk:
   * the idle external-writer gate must not SESSION_NOT_FOUND a session whose
   * file Pi has not written yet (and nothing external can have touched). */
  private pendingMaterialization = false;
  private readonly now: () => number;
  private readonly window: number;

  constructor(private readonly deps: ChatSessionManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.window = deps.activeWindowMs ?? 10_000;
  }

  get isOpen(): boolean {
    return this.client !== null && this.client.alive;
  }

  private emit(ev: ChatEventT): void {
    this.deps.onEvent?.(ev);
  }

  private async statOrThrow(file: string): Promise<{ size: number; mtimeMs: number }> {
    try {
      return await this.deps.fs.stat(file);
    } catch (err) {
      throw new BridgeError('SESSION_NOT_FOUND', `Session file not readable: ${file} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  async open(file: string): Promise<RpcStateT | null> {
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

    const client = new PiRpcClient({
      spawn: () =>
        this.deps.spawnRpc({
          piPath,
          args: ['--mode', 'rpc', '--session', file],
          cwd,
          env: { ...this.deps.env, PATH: buildProbePath(this.deps.home) },
        }),
      ...this.deps.rpcOptions,
      onEvent: (name, record) => this.emit({ kind: 'pi', name, data: record }),
      onExit: () => {
        if (this.client !== client) return;
        this.client = null;
        this.file = null;
        this.runActive = false;
        this.emit({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited' });
      },
    });
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
    this.runActive = false;
    this.pendingMaterialization = false;
    // After the initial load (which may legitimately rewrite legacy files via
    // the official API), snapshot the idle baseline.
    const post = await this.statOrThrow(file).catch(() => meta);
    this.idleMtimeMs = post.mtimeMs;
    this.emit({ kind: 'opened', state });
    return state;
  }

  /**
   * R03 п.2 — REAL session creation over Pi's own RPC (probe-verified):
   * spawn a bare `pi --mode rpc`, let get_state resolve the future session
   * file, then queue the durable display name. Same single-slot policy as
   * open(): a live chat is never auto-closed (RESOURCE_BUSY). No prompt and
   * no fake content — without a first user message Pi keeps no file at all
   * (mirrors _hasConversation), so callers must treat the record as
   * provisional until it appears in the index.
   */
  async create(projectPath?: string): Promise<{ state: RpcStateT; cwd: string }> {
    if (this.client) {
      if (this.client.alive) {
        throw new BridgeError('RESOURCE_BUSY', 'A chat session is already open — close it before creating a new one');
      }
      this.client = null; // stale dead handle (exit event not yet observed)
    }

    const piPath = await this.deps.resolvePi();
    if (!piPath) throw new BridgeError('PI_NOT_FOUND', 'Pi executable not found for chat spawn');
    // The bridge owns the default cwd (its own resource cwd); projectPath is
    // a bridge-discovered project path validated by NewSessionParamsSchema.
    const cwd = projectPath ?? this.deps.env.PI_WS_DESKTOP_AGENT_CWD ?? process.cwd();

    const client = new PiRpcClient({
      spawn: () =>
        this.deps.spawnRpc({
          piPath,
          args: ['--mode', 'rpc'],
          cwd,
          env: { ...this.deps.env, PATH: buildProbePath(this.deps.home) },
        }),
      ...this.deps.rpcOptions,
      onEvent: (name, record) => this.emit({ kind: 'pi', name, data: record }),
      onExit: () => {
        if (this.client !== client) return;
        this.client = null;
        this.file = null;
        this.runActive = false;
        this.pendingMaterialization = false;
        this.emit({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited' });
      },
    });
    client.connect();

    let state: RpcStateT;
    try {
      const raw = await client.request('get_state');
      state = mapRpcState(raw);
      if (!state.sessionFile || !state.sessionId) {
        // Fail closed: without a concrete file/id there is no honest record.
        throw new BridgeError('PROTOCOL_ERROR', `Pi did not resolve a new sessionFile (${state.sessionFile ?? 'none'})`);
      }
      await client.request('set_session_name', { name: NEW_DIALOG_NAME });
    } catch (err) {
      // Teardown BEFORE rethrow — a failed create never leaves a zombie RPC.
      await client.close().catch(() => undefined);
      if (err instanceof BridgeError) throw err;
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcCommandError) throw new BridgeError('PROTOCOL_ERROR', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('BRIDGE_TIMEOUT', `Pi RPC exited during create: ${err.message}`);
      throw new BridgeError('BRIDGE_TIMEOUT', err instanceof Error ? err.message : String(err));
    }

    this.client = client;
    this.file = state.sessionFile;
    this.runActive = false;
    this.pendingMaterialization = true;
    this.idleMtimeMs = 0;
    this.emit({ kind: 'opened', state });
    return { state, cwd };
  }

  async sendPrompt(message: string, streamingBehavior?: 'steer' | 'followUp'): Promise<{ disposition: string }> {
    const client = this.client;
    if (!client || !client.alive || !this.file) {
      throw new BridgeError('DISCONNECTED', 'No chat session is open');
    }

    // Idle-time external-writer gate (skip while OUR run owns the file).
    if (!this.runActive && this.file) {
      const meta = this.pendingMaterialization
        ? await this.deps.fs.stat(this.file).catch(() => null)
        : await this.statOrThrow(this.file);
      // meta === null ⇔ created but not yet persisted by the first message:
      // nothing external can have written a file that does not exist yet.
      if (meta && meta.mtimeMs > this.idleMtimeMs) {
        throw new BridgeError(
          'SESSION_CONFLICT',
          'Session file changed while the chat was idle — another writer (CLI?) appended to it. Reload the history before prompting.',
        );
      }
    }

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
            if (this.file === file) {
              this.idleMtimeMs = m.mtimeMs;
              this.pendingMaterialization = false; // first run persisted the file
            }
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
        this.emit({ kind: 'closed', code, message });
      },
    );
    return { disposition: started.disposition };
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

  async getState(): Promise<{ state: RpcStateT | null }> {
    const client = this.client;
    if (!client || !client.alive) return { state: null };
    try {
      return { state: mapRpcState(await client.request('get_state')) };
    } catch (err) {
      if (err instanceof RpcTimeoutError) throw new BridgeError('BRIDGE_TIMEOUT', err.message);
      if (err instanceof RpcDisconnectedError) throw new BridgeError('DISCONNECTED', err.message);
      throw err;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.file = null;
    this.runActive = false;
    if (!client) return;
    await client.close().catch(() => undefined);
    this.emit({ kind: 'closed', code: 'CANCELLED', message: 'chat closed by user' });
  }
}
