import { describe, expect, it } from 'vitest';
import {
  ALL_ERROR_CODES,
  FrameTooLargeError,
  type FrameT,
  MAX_FRAME_BYTES,
  M0_METHODS,
  PROTOCOL_VERSION,
  encodeFrame,
  mapUnknownMethod,
  parseFrameLine,
} from '../../src/shared/protocol';

describe('bridge protocol contract (Zod)', () => {
  it('accepts a valid request frame', () => {
    const line = JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'request',
      requestId: 'req-1',
      method: 'health',
      params: {},
      timeoutMs: 1000,
    });
    const parsed = parseFrameLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.frame).toMatchObject({ type: 'request', requestId: 'req-1', method: 'health' });
    }
  });

  it('rejects a request without requestId', () => {
    const line = JSON.stringify({ v: PROTOCOL_VERSION, type: 'request', method: 'health' });
    const parsed = parseFrameLine(line);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('schema');
  });

  it('rejects unsupported protocol version', () => {
    const line = JSON.stringify({ v: 2, type: 'request', requestId: 'r', method: 'health' });
    const parsed = parseFrameLine(line);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('schema');
  });

  it('rejects requestId longer than 64 chars or empty', () => {
    for (const requestId of ['', 'x'.repeat(65)]) {
      const line = JSON.stringify({ v: PROTOCOL_VERSION, type: 'request', requestId, method: 'health' });
      const parsed = parseFrameLine(line);
      expect(parsed.ok).toBe(false);
    }
  });

  it('maps invalid JSON line to invalid_json', () => {
    const parsed = parseFrameLine('{not json');
    expect(parsed).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('maps valid JSON with wrong shape to schema', () => {
    const parsed = parseFrameLine(JSON.stringify({ hello: 'world' }));
    expect(parsed).toEqual({ ok: false, reason: 'schema' });
  });

  it('rejects a frame larger than MAX_FRAME_BYTES at parse time', () => {
    const big = 'x'.repeat(MAX_FRAME_BYTES + 1);
    const parsed = parseFrameLine(big);
    expect(parsed).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects encoding a frame larger than MAX_FRAME_BYTES', () => {
    const frame: FrameT = {
      v: PROTOCOL_VERSION,
      type: 'response' as const,
      requestId: 'r1',
      status: 'ok' as const,
      result: { blob: 'x'.repeat(MAX_FRAME_BYTES) },
    };
    expect(() => encodeFrame(frame)).toThrow(FrameTooLargeError);
  });

  it('accepts an ok response and an error response with every declared error code', () => {
    const ok = encodeFrame({
      v: PROTOCOL_VERSION,
      type: 'response',
      requestId: 'r1',
      status: 'ok',
      result: { uptimeMs: 12 },
    });
    expect(ok.endsWith('\n')).toBe(false);
    expect(parseFrameLine(ok).ok).toBe(true);

    for (const code of ALL_ERROR_CODES) {
      const err = encodeFrame({
        v: PROTOCOL_VERSION,
        type: 'response',
        requestId: 'r1',
        status: 'error',
        error: { code, message: 'boom' },
      });
      expect(parseFrameLine(err).ok).toBe(true);
    }

    const bad = JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'response',
      requestId: 'r1',
      status: 'error',
      error: { code: 'BOOM', message: 'boom' },
    });
    expect(parseFrameLine(bad).ok).toBe(false);
  });

  it('accepts cancel and event frames', () => {
    const cancel = JSON.stringify({ v: PROTOCOL_VERSION, type: 'cancel', requestId: 'r1' });
    const event = JSON.stringify({ v: PROTOCOL_VERSION, type: 'event', event: 'ready', payload: { pid: 1 } });
    expect(parseFrameLine(cancel).ok).toBe(true);
    expect(parseFrameLine(event).ok).toBe(true);
  });

  it('maps unknown methods to METHOD_NOT_ALLOWED and known methods to null', () => {
    expect(mapUnknownMethod('exec')).toEqual({
      code: 'METHOD_NOT_ALLOWED',
      message: expect.stringContaining('exec'),
    });
    expect(mapUnknownMethod('writeFile')).not.toBeNull();
    for (const method of M0_METHODS) {
      expect(mapUnknownMethod(method)).toBeNull();
    }
  });

  it('requires every SPEC §7 error code to be present in ALL_ERROR_CODES', () => {
    for (const code of [
      'WSL_UNAVAILABLE',
      'NODE_NOT_FOUND',
      'PI_NOT_FOUND',
      'PI_INCOMPATIBLE',
      'BRIDGE_TIMEOUT',
      'SESSION_CONFLICT',
      'UNTRUSTED_PROJECT',
      'RESOURCE_BUSY',
      'MCP_ERROR',
    ]) {
      expect(ALL_ERROR_CODES).toContain(code);
    }
  });
});
