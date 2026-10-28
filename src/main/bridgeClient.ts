/**
 * Desktop-side bridge client: framing, request correlation, per-request
 * timeouts with best-effort cancel, protocol-error tolerance with forced
 * teardown, and pending-request rejection on any disconnect.
 */
import { randomUUID } from 'node:crypto';
import { BRIDGE_HANDLER_MARGIN_MS, BRIDGE_REQUEST_TIMEOUT_MS } from '../shared/timeouts';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { LineAssembler } from '../shared/framing';
import { BridgeError } from '../shared/errors';
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  encodeFrame,
  parseFrameLine,
  type FrameT,
} from '../shared/protocol';

export interface BridgeClientOptions {
  spawn: () => ChildProcessWithoutNullStreams;
  requestTimeoutMs?: number;
  maxProtocolErrors?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export interface PendingRequest {
  requestId: string;
  response: Promise<unknown>;
}

type Listener = (...args: never[]) => void;

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly assembler = new LineAssembler(MAX_FRAME_BYTES);
  private protocolErrors = 0;
  private closing = false;

  constructor(private readonly opts: BridgeClientOptions) {}

  on(event: 'ready', listener: (payload: unknown) => void): () => void;
  on(event: 'event', listener: (frame: unknown) => void): () => void;
  on(event: 'lost', listener: (info: { reason: string }) => void): () => void;
  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  get connected(): boolean {
    return this.child !== null;
  }

  connect(): void {
    if (this.child) return;
    this.closing = false;
    this.protocolErrors = 0;
    this.assembler.reset();
    const child = this.opts.spawn();
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      const { lines, overflow } = this.assembler.push(chunk);
      if (overflow) {
        this.destroy('overflow: frame exceeds MAX_FRAME_BYTES');
        return;
      }
      for (const line of lines) this.handleLine(line);
    });

    child.once('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(new BridgeError('DISCONNECTED', `bridge exited (code ${code})`));
      if (!this.closing) this.emit('lost', { reason: `bridge exited (code ${code})` });
    });

    child.once('error', (err) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(new BridgeError('DISCONNECTED', `bridge spawn error: ${err.message}`));
      if (!this.closing) this.emit('lost', { reason: `bridge spawn error: ${err.message}` });
    });
  }

  private handleLine(line: string): void {
    const parsed = parseFrameLine(line);
    if (!parsed.ok) {
      this.protocolErrors += 1;
      const max = this.opts.maxProtocolErrors ?? 3;
      if (this.protocolErrors >= max) {
        this.destroy(`protocol: ${this.protocolErrors} invalid frames from bridge`);
      }
      return;
    }
    const frame = parsed.frame;
    if (frame.type === 'event') {
      if (frame.event === 'ready') this.emit('ready', frame.payload);
      this.emit('event', frame);
      return;
    }
    if (frame.type !== 'response') return; // bridges never send requests/cancels
    const entry = this.pending.get(frame.requestId);
    if (!entry) return; // late response after timeout/cancel — drop by design
    clearTimeout(entry.timer);
    this.pending.delete(frame.requestId);
    if (frame.status === 'ok') {
      entry.resolve(frame.result);
    } else {
      entry.reject(new BridgeError(frame.error.code, frame.error.message));
    }
  }

  send(method: string, params?: Record<string, unknown>, options: RequestOptions = {}): PendingRequest {
    const requestId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.opts.requestTimeoutMs ?? 10_000;
    const response = new Promise<unknown>((resolve, reject) => {
      if (!this.child) {
        reject(new BridgeError('DISCONNECTED', 'bridge client is not connected'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        // Best-effort cancel; the late response is dropped on arrival.
        this.writeFrame({ v: PROTOCOL_VERSION, type: 'cancel', requestId }).catch(() => undefined);
        reject(new BridgeError('BRIDGE_TIMEOUT', `request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      // UI21 F1-B R02 (P1): бюджет ОБЯЗАН уехать в bridge. Без него bridge
      // применял свой дефолт 10 000 мс, помечал обработчик просроченным и
      // превращал успешный медленный ACK в BRIDGE_TIMEOUT (наш обработчик
      // отмену игнорирует, поэтому генерация шла, а пользователь видел отказ).
      // Передаём бюджет меньше собственного — ошибку формирует bridge.
      // Бюджет bridge = внешний минус запас, но не ниже прежних 10 000 мс
      // (читающие запросы остаются ровно такими, какими были). Значение берём
      // из общего helper'а, чтобы он точно описывал поведение на проводе.
      const handlerTimeoutMs = Math.max(
        BRIDGE_REQUEST_TIMEOUT_MS,
        timeoutMs - BRIDGE_HANDLER_MARGIN_MS,
      );
      const frame: FrameT = {
        v: PROTOCOL_VERSION,
        type: 'request',
        requestId,
        method,
        timeoutMs: handlerTimeoutMs,
        ...(params ? { params } : {}),
      };
      this.writeFrame(frame).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new BridgeError('DISCONNECTED', `write failed: ${String(err)}`));
      });
    });
    return { requestId, response };
  }

  request(method: string, params?: Record<string, unknown>, options: RequestOptions = {}): Promise<unknown> {
    return this.send(method, params, options).response;
  }

  cancel(requestId: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.reject(new BridgeError('CANCELLED', 'request cancelled'));
    this.writeFrame({ v: PROTOCOL_VERSION, type: 'cancel', requestId }).catch(() => undefined);
    return true;
  }

  private writeFrame(frame: FrameT): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new BridgeError('DISCONNECTED', 'bridge client is not connected'));
        return;
      }
      this.child.stdin.write(encodeFrame(frame) + '\n', (err?: Error | null) => {
        if (err) reject(new BridgeError('DISCONNECTED', `stdin write failed: ${err.message}`));
        else resolve();
      });
    });
  }

  private rejectAll(err: BridgeError): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private destroy(reason: string): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
    this.rejectAll(new BridgeError('DISCONNECTED', reason));
    this.emit('lost', { reason });
  }

  /** Tear down intentionally: kill the child, reject pending, emit no 'lost'. */
  close(): void {
    this.closing = true;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
    this.rejectAll(new BridgeError('DISCONNECTED', 'client closed'));
  }
}
