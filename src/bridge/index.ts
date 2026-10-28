/**
 * Persistent WSL Bridge entrypoint.
 *
 * Speaks versioned NDJSON on stdout (protocol only) and diagnostics on
 * stderr. One long-lived process serves many requests; every request is
 * correlated by requestId, bounded by a timeout and cancellable. The method
 * allowlist is read-only for M0. No listeners, no network, no writes.
 */
import { LineAssembler } from '../shared/framing';
import { BRIDGE_MAX_REQUEST_TIMEOUT_MS, BRIDGE_REQUEST_TIMEOUT_MS } from '../shared/timeouts';
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  encodeFrame,
  mapUnknownMethod,
  parseFrameLine,
  type ErrorCode,
  type FrameT,
  type RequestFrameT,
} from '../shared/protocol';
import { BridgeError, makeHandlers } from './handlers';

// UI21 F1-B R02: оба предела — из общего модуля, чтобы bridge не обрывал
// запрос раньше main (иначе медленный успешный ACK снова станет отказом).
const DEFAULT_TIMEOUT_MS = BRIDGE_REQUEST_TIMEOUT_MS;
const MAX_TIMEOUT_MS = BRIDGE_MAX_REQUEST_TIMEOUT_MS;

export function startBridge(env: NodeJS.ProcessEnv = process.env): void {
  const stdout = process.stdout;
  const testMode = env.PI_WS_DESKTOP_BRIDGE_TEST_MODE === '1';
  const pending = new Map<string, AbortController>();
  const assembler = new LineAssembler(MAX_FRAME_BYTES);

  let writeChain: Promise<void> = Promise.resolve();
  const emit = (frame: FrameT): void => {
    writeChain = writeChain.then(() => {
      stdout.write(encodeFrame(frame) + '\n');
    });
  };
  const handlers = makeHandlers({
    env,
    home: env.HOME ?? '',
    testMode,
    pid: process.pid,
    emitEvent: (event, payload) => emit({ v: PROTOCOL_VERSION, type: 'event', event, payload }),
  });
  const respondError = (requestId: string, code: ErrorCode, message: string): void => {
    emit({ v: PROTOCOL_VERSION, type: 'response', requestId, status: 'error', error: { code, message } });
  };
  const protocolEvent = (reason: string): void => {
    process.stderr.write(`[bridge] protocol error: ${reason}\n`);
    emit({ v: PROTOCOL_VERSION, type: 'event', event: 'protocol_error', payload: { reason } });
  };

  const respondOrEvent = (raw: unknown, code: ErrorCode, message: string): void => {
    const requestId =
      raw && typeof raw === 'object' && 'requestId' in raw && typeof (raw as { requestId: unknown }).requestId === 'string'
        ? (raw as { requestId: string }).requestId
        : null;
    if (requestId && requestId.length >= 1 && requestId.length <= 64) {
      respondError(requestId, code, message);
    } else {
      protocolEvent(`${code}: ${message}`);
    }
  };

  const handleRequest = (frame: RequestFrameT): void => {
    const { requestId, method, params, timeoutMs } = frame;
    // Own-property gate: a plain `handlers[method]` lookup would serve
    // inherited Object.prototype keys (constructor/toString/…) and crash on
    // __proto__. The allowlist must hold at the protocol boundary itself.
    const handler = Object.prototype.hasOwnProperty.call(handlers, method) ? handlers[method] : undefined;
    if (typeof handler !== 'function') {
      const denied = mapUnknownMethod(method);
      respondError(requestId, 'METHOD_NOT_ALLOWED', denied?.message ?? `Method not allowed: ${method}`);
      return;
    }
    if (pending.has(requestId)) {
      respondError(requestId, 'INVALID_REQUEST', `duplicate in-flight requestId: ${requestId}`);
      return;
    }
    const controller = new AbortController();
    pending.set(requestId, controller);
    const limit = Math.min(Math.max(timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limit);

    Promise.resolve(handler(params ?? {}, controller.signal))
      .then((result) => {
        if (timedOut) {
          // a signal-ignoring handler must not turn a timeout into an ok
          respondError(requestId, 'BRIDGE_TIMEOUT', `method ${method} exceeded ${limit}ms`);
          return;
        }
        emit({ v: PROTOCOL_VERSION, type: 'response', requestId, status: 'ok', result });
      })
      .catch((err: unknown) => {
        if (timedOut) {
          respondError(requestId, 'BRIDGE_TIMEOUT', `method ${method} exceeded ${limit}ms`);
        } else if (err instanceof BridgeError) {
          respondError(requestId, err.code, err.message);
        } else if (controller.signal.aborted) {
          respondError(requestId, 'CANCELLED', 'request cancelled');
        } else {
          const message = err instanceof Error ? err.message : String(err);
          respondError(requestId, 'UNKNOWN', `internal error: ${message}`);
        }
      })
      .finally(() => {
        clearTimeout(timer);
        pending.delete(requestId);
      });
  };

  process.stderr.write(
    `[bridge] started pid=${process.pid} protocolVersion=${PROTOCOL_VERSION} testMode=${testMode}\n`,
  );
  emit({
    v: PROTOCOL_VERSION,
    type: 'event',
    event: 'ready',
    payload: { pid: process.pid, protocolVersion: PROTOCOL_VERSION, testMode },
  });

  process.stdin.on('data', (chunk: Buffer) => {
    const { lines, overflow } = assembler.push(chunk);
    if (overflow) {
      protocolEvent('frame exceeds MAX_FRAME_BYTES');
      void writeChain.then(() => process.exit(2));
      return;
    }
    for (const line of lines) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        protocolEvent('invalid_json');
        continue;
      }
      if (
        raw === null ||
        typeof raw !== 'object' ||
        !('v' in raw) ||
        (raw as { v: unknown }).v !== PROTOCOL_VERSION
      ) {
        respondOrEvent(raw, 'UNSUPPORTED_VERSION', `expected protocolVersion=${PROTOCOL_VERSION}`);
        continue;
      }
      const parsed = parseFrameLine(line);
      if (!parsed.ok) {
        respondOrEvent(raw, 'INVALID_REQUEST', `frame failed validation (${parsed.reason})`);
        continue;
      }
      const frame = parsed.frame;
      if (frame.type === 'request') {
        handleRequest(frame);
      } else if (frame.type === 'cancel') {
        pending.get(frame.requestId)?.abort();
      } else {
        protocolEvent(`unexpected frame type from client: ${frame.type}`);
      }
    }
  });

  process.stdin.on('end', () => {
    void writeChain.then(() => process.exit(0));
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

if (require.main === module) {
  startBridge();
}
