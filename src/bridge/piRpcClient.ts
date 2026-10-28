/**
 * Subprocess client for Pi's official RPC mode (installed Pi 1.3.0 —
 * verified against the bundled rpc.md / rpc-commands.md / json.md docs).
 *
 * Protocol facts this client implements:
 * - strict JSONL on stdin/stdout, split on LF ONLY (U+2028/U+2029 are legal
 *   inside JSON strings — we reuse M0's byte LineAssembler, never readline);
 * - commands carry a unique string `id`; responses repeat it — correlate by
 *   id, never by order; sessions events have no id;
 * - `prompt` accepted ≠ run finished: wait for `agent_settled` (epoch-guarded
 *   against fast completions); `handled` dispositions never settle;
 * - `abort` responds only after the session is idle;
 * - stdout must be consumed continuously; stderr is diagnostics only;
 * - extension UI: fire-and-forget records are ignorable, blocking dialogs are
 *   auto-cancelled by default so a dialog can never wedge the bridge (custom
 *   handler optional — full dialog UX belongs to M2);
 * - shutdown = stdin EOF, then SIGKILL fallback;
 * - NO auto-restart and NO command replay after disconnect: after an
 *   indeterminate crash the caller must explicitly re-open (no double
 *   generation), every pending promise rejects with RpcDisconnectedError.
 */
import { LineAssembler } from '../shared/framing';
import {
  PI_COMMAND_TIMEOUT_MS,
  PI_INTERRUPT_TIMEOUT_MS,
  PI_PROMPT_ACK_TIMEOUT_MS,
  PI_SETTLE_TIMEOUT_MS,
} from '../shared/timeouts';

export interface RpcProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- listener args vary by event; both call sites narrow them
  on(event: 'exit' | 'error', listener: (...args: any[]) => void): unknown;
}

export class RpcCommandError extends Error {
  constructor(
    message: string,
    public readonly command: string,
  ) {
    super(message);
    this.name = 'RpcCommandError';
  }
}
export class RpcTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcTimeoutError';
  }
}
export class RpcDisconnectedError extends Error {
  constructor(message = 'Pi RPC process is not running') {
    super(message);
    this.name = 'RpcDisconnectedError';
  }
}
export class RpcProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcProtocolError';
  }
}

/** One stdout record forwarded to subscribers (verbatim — forward compatible). */
export interface PiEvent {
  name: string;
  record: unknown;
}

export interface ExtensionUiRequest {
  id: string;
  method: string;
  [k: string]: unknown;
}
export type ExtensionUiResponder = (response: Record<string, unknown>) => void;

export interface PiRpcClientOptions {
  spawn: () => RpcProcess;
  commandTimeoutMs?: number;
  settleTimeoutMs?: number;
  exitWaitMs?: number;
  maxLineBytes?: number;
  onEvent?: (name: string, record: unknown) => void;
  onDiagnostic?: (message: string) => void;
  onExit?: (code: number | null) => void;
  /** Return true if handled (then the client writes nothing itself). */
  onExtensionUi?: (req: ExtensionUiRequest, respond: ExtensionUiResponder) => void;
}

const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);
const DEFAULTS = {
  commandTimeoutMs: PI_COMMAND_TIMEOUT_MS,
  settleTimeoutMs: PI_SETTLE_TIMEOUT_MS,
  exitWaitMs: 3_000,
  maxLineBytes: 16 * 1024 * 1024,
};

interface Pending {
  command: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface SettleWaiter {
  resolve: (v: { aborted: boolean }) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class PiRpcClient {
  private proc: RpcProcess | null = null;
  private assembler: LineAssembler;
  private readonly pending = new Map<string, Pending>();
  private readonly settleWaiters: SettleWaiter[] = [];
  private seq = 0;
  private settledEpoch = 0;
  private exited = false;
  private started = false;

  constructor(private readonly opts: PiRpcClientOptions) {
    this.assembler = new LineAssembler(opts.maxLineBytes ?? DEFAULTS.maxLineBytes);
  }

  get alive(): boolean {
    return this.started && !this.exited;
  }

  connect(): void {
    if (this.started) return;
    this.started = true;
    this.exited = false;
    const proc = this.opts.spawn();
    this.proc = proc;

    proc.stdout.on('data', (chunk: Buffer) => {
      const { lines, overflow } = this.assembler.push(chunk);
      if (overflow) {
        this.failAllPending(new RpcProtocolError('oversize record from Pi stdout'));
        this.diagnostic('oversize record from Pi stdout — killing the connection');
        this.killHard();
        return;
      }
      for (const line of lines) this.handleLine(line);
    });
    proc.on('error', (err) => {
      this.diagnostic(`Pi RPC process error: ${err.message}`);
      // 'exit' will follow; nothing else to do
    });
    proc.on('exit', (code) => {
      if (this.exited) return;
      this.exited = true;
      this.failAllPending(new RpcDisconnectedError('Pi RPC process exited'));
      this.rejectSettleWaiters(new RpcDisconnectedError('Pi RPC process exited'));
      this.opts.onExit?.(code);
    });
  }

  private diagnostic(msg: string): void {
    this.opts.onDiagnostic?.(msg);
  }

  private write(obj: Record<string, unknown>): void {
    if (!this.proc || this.exited) throw new RpcDisconnectedError();
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  request<T = unknown>(
    command: string,
    fields: Record<string, unknown> = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (!this.started || this.exited || !this.proc) {
      return Promise.reject(new RpcDisconnectedError());
    }
    this.seq += 1;
    const id = `c${this.seq}`;
    const timeoutMs = opts.timeoutMs ?? this.opts.commandTimeoutMs ?? DEFAULTS.commandTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(`Pi command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { command, resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.write({ id, type: command, ...fields });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Stage 1: submit the prompt and return as soon as Pi ACCEPTED it
   * (`disposition`) — plus a `run` promise that settles at `agent_settled`.
   * This split is what lets the bridge answer `sendPrompt` with the
   * disposition while the stream keeps flowing to subscribers.
   */
  async startPrompt(
    message: string,
    opts: { streamingBehavior?: 'steer' | 'followUp'; settleTimeoutMs?: number } = {},
  ): Promise<{ disposition: string; run: Promise<{ aborted: boolean }> }> {
    const epochBefore = this.settledEpoch;
    const fields: Record<string, unknown> = { message };
    if (opts.streamingBehavior) fields.streamingBehavior = opts.streamingBehavior;
    // UI21 F1-B R02 (P1): это бюджет ACK, а не длительности ответа модели —
    // холодная сессия подтверждает приём дольше общего тайм-аута команд.
    const data = (await this.request<{ disposition?: string }>('prompt', fields, {
      timeoutMs: PI_PROMPT_ACK_TIMEOUT_MS,
    })) ?? {};
    const disposition = typeof data.disposition === 'string' ? data.disposition : 'started';
    if (disposition === 'handled') return { disposition, run: Promise.resolve({ aborted: false }) };
    if (this.settledEpoch > epochBefore) {
      // Fast completion: settled already arrived between send and response.
      return { disposition, run: Promise.resolve({ aborted: this.lastAbortState }) };
    }
    const settleMs = opts.settleTimeoutMs ?? this.opts.settleTimeoutMs ?? DEFAULTS.settleTimeoutMs;
    const run = new Promise<{ aborted: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.settleWaiters.findIndex((w) => w.resolve === wrappedResolve);
        if (i >= 0) this.settleWaiters.splice(i, 1);
        reject(new RpcTimeoutError(`agent_settled did not arrive within ${settleMs}ms`));
      }, settleMs);
      const wrappedResolve = (v: { aborted: boolean }): void => {
        clearTimeout(timer);
        resolve(v);
      };
      this.settleWaiters.push({
        resolve: wrappedResolve,
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      });
    });
    return { disposition, run };
  }

  /**
   * Submit a prompt and run until the session is terminal for this submission
   * (epoch-guarded against completions that land before the response).
   */
  async promptAndWait(
    message: string,
    opts: { streamingBehavior?: 'steer' | 'followUp'; settleTimeoutMs?: number } = {},
  ): Promise<{ disposition: string; aborted: boolean }> {
    const { disposition, run } = await this.startPrompt(message, opts);
    const { aborted } = await run;
    return { disposition, aborted };
  }

  private lastAbortState = false;

  /** Abort the current run; Pi responds only once the session is idle. */
  interrupt(): Promise<unknown> {
    return this.request('abort', {}, { timeoutMs: Math.max(PI_INTERRUPT_TIMEOUT_MS, this.opts.commandTimeoutMs ?? 0) });
  }

  async close(): Promise<void> {
    if (!this.proc || this.exited) {
      this.exited = true;
      return;
    }
    const proc = this.proc;
    const waitMs = this.opts.exitWaitMs ?? DEFAULTS.exitWaitMs;
    const exited = new Promise<void>((resolve) => {
      if (this.exited) {
        resolve();
        return;
      }
      proc.on('exit', () => resolve());
    });
    try {
      proc.stdin.end();
    } catch {
      /* already gone */
    }
    let eofTimer: NodeJS.Timeout | undefined;
    const forced = await Promise.race([
      exited.then(() => 'exited' as const),
      new Promise<'timeout'>((r) => {
        eofTimer = setTimeout(() => r('timeout'), waitMs);
      }),
    ]);
    if (eofTimer !== undefined) clearTimeout(eofTimer); // review round 3, #6: no orphan timers
    if (forced === 'timeout') {
      this.diagnostic(`Pi RPC ignored stdin EOF for ${waitMs}ms — SIGKILL`);
      this.killHard();
      let killTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise<void>((r) => {
          killTimer = setTimeout(r, 1_000);
        }),
      ]);
      if (killTimer !== undefined) clearTimeout(killTimer); // review round 3, #6
    }
    this.exited = true;
  }

  private killHard(): void {
    try {
      this.proc?.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    if (!this.exited) {
      this.exited = true;
      this.failAllPending(new RpcDisconnectedError('Pi RPC connection killed'));
      this.rejectSettleWaiters(new RpcDisconnectedError('Pi RPC connection killed'));
    }
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private rejectSettleWaiters(err: Error): void {
    for (const w of this.settleWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  private handleLine(line: string): void {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      this.diagnostic(`non-JSON record from Pi stdout: ${line.slice(0, 120)}`);
      return;
    }
    if (record === null || typeof record !== 'object') {
      this.diagnostic('non-object record from Pi stdout');
      return;
    }
    const rec = record as Record<string, unknown>;

    if (rec.type === 'response' && typeof rec.id === 'string') {
      const entry = this.pending.get(rec.id);
      if (!entry) {
        this.diagnostic(`late/unknown response id=${String(rec.id)} (command=${String(rec.command)})`);
        return;
      }
      this.pending.delete(rec.id);
      clearTimeout(entry.timer);
      if (rec.success === true) {
        entry.resolve(rec.data);
      } else {
        entry.reject(new RpcCommandError(String(rec.error ?? 'Pi command failed'), entry.command));
      }
      return;
    }

    if (rec.type === 'response' && rec.id === undefined) {
      // A response without id (rpc.md parse errors carry none): if exactly one
      // command is outstanding it is ours — success resolves, failure rejects.
      if (this.pending.size === 1) {
        const [id, entry] = [...this.pending.entries()][0];
        this.pending.delete(id);
        clearTimeout(entry.timer);
        if (rec.success === true) {
          entry.resolve(rec.data);
        } else {
          entry.reject(new RpcCommandError(String(rec.error ?? 'Pi rejected the command'), entry.command));
        }
      } else {
        this.diagnostic(`Pi response without id: ${line.slice(0, 160)}`);
      }
      return;
    }

    if (rec.type === 'extension_ui_request') {
      const req = rec as ExtensionUiRequest;
      if (this.opts.onExtensionUi) {
        this.opts.onExtensionUi(req, (resp) => {
          try {
            this.write(resp);
          } catch {
            /* connection gone */
          }
        });
        return;
      }
      if (DIALOG_METHODS.has(String(req.method))) {
        // Blocking dialog: auto-cancel so the run can never wedge the bridge.
        try {
          this.write({ type: 'extension_ui_response', id: req.id, cancelled: true });
        } catch {
          /* connection gone */
        }
      }
      // fire-and-forget: ignorable per rpc docs
      return;
    }

    // Session event (agent_*, turn_*, message_*, tool_*, …) — no id.
    if (rec.type === 'agent_settled') {
      this.settledEpoch += 1;
      this.lastAbortState = rec.aborted === true;
      const aborted = this.lastAbortState;
      for (const w of this.settleWaiters.splice(0)) {
        clearTimeout(w.timer);
        w.resolve({ aborted });
      }
    }
    this.opts.onEvent?.(String(rec.type ?? 'unknown'), rec);
  }
}
