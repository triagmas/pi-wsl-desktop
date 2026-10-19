import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  type ResponseErrorFrameT,
  type ResponseOkFrameT,
} from '../../src/shared/protocol';
import { FrameReader } from '../helpers/frameReader';
import { removeBridgeBundle, spawnBridge } from '../helpers/bridgeFixture';

function req(requestId: string, method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'request',
    requestId,
    method,
    ...(params ? { params } : {}),
  });
}

function makeFakePi(dir: string, rpc: boolean): string {
  const p = path.join(dir, 'fakepi');
  const help = rpc
    ? 'Usage: pi\n  --mode <mode>   Output mode: text (default), json, or rpc\n'
    : 'Usage: pi\n  --json          output json\n';
  writeFileSync(
    p,
    `#!/bin/sh\ncase "$1" in\n  --version) echo "9.9.9";;\n  --help) printf '%s' '${help.replace(/'/g, "'\\''")}';;\n  *) exit 1;;\nesac\n`,
  );
  chmodSync(p, 0o755);
  return p;
}

afterAll(async () => {
  await removeBridgeBundle();
});

describe('bridge server (real subprocess, fake env)', () => {
  it('emits ready event first, then answers health with matching requestId', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-'));
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      const ready = await reader.waitForEvent('ready');
      expect(ready.frame).toMatchObject({ v: PROTOCOL_VERSION, type: 'event', event: 'ready' });

      child.stdin.write(req('h1', 'health') + '\n');
      const resp = await reader.waitForResponse('h1');
      expect(resp.frame).toMatchObject({ type: 'response', status: 'ok' });
      const data = (resp.frame as ResponseOkFrameT).result as { status: string; protocolVersion: number };
      expect(data.status).toBe('ok');
      expect(data.protocolVersion).toBe(PROTOCOL_VERSION);
    } finally {
      child.kill();
    }
  });

  it('rejects methods outside the read-only allowlist', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('u1', 'exec') + '\n');
      const resp = await reader.waitForResponse('u1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('METHOD_NOT_ALLOWED');
    } finally {
      child.kill();
    }
  });

  it('emits protocol_error for invalid JSON and keeps serving', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write('{definitely not json\n');
      await reader.waitForEvent('protocol_error');
      child.stdin.write(req('h2', 'health') + '\n');
      const resp = await reader.waitForResponse('h2');
      expect((resp.frame as ResponseOkFrameT).status).toBe('ok');
    } finally {
      child.kill();
    }
  });

  it('answers UNSUPPORTED_VERSION for frames with a different protocol version', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(
        JSON.stringify({ v: 99, type: 'request', requestId: 'v1', method: 'health' }) + '\n',
      );
      const resp = await reader.waitForResponse('v1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('UNSUPPORTED_VERSION');
    } finally {
      child.kill();
    }
  });

  it('answers INVALID_REQUEST for schema-invalid frames that carry a requestId', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(JSON.stringify({ v: PROTOCOL_VERSION, type: 'request', requestId: 's1' }) + '\n');
      const resp = await reader.waitForResponse('s1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }
  });

  it('keeps stdout pure protocol: every stdout line parses, diagnostics go to stderr', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write('{broken\n');
      child.stdin.write(req('h3', 'health') + '\n');
      await reader.waitForResponse('h3');
      expect(reader.frames.length).toBeGreaterThanOrEqual(3);
      for (const f of reader.frames) expect(f.frame).not.toBeNull();
      expect(child.stderrText).toContain('[bridge]');
      expect(child.stderrText).not.toContain('"type":"response"');
    } finally {
      child.kill();
    }
  });

  it('exits with code 2 on an oversized frame after emitting protocol_error', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      await reader.waitForEvent('ready');
      child.stdin.write('x'.repeat(MAX_FRAME_BYTES + 16) + '\n');
      await reader.waitForEvent('protocol_error');
      expect(await exited).toBe(2);
    } finally {
      child.kill();
    }
  });

  it('hides __test_slow outside test mode', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('t0', '__test_slow', { ms: 10 }) + '\n');
      const resp = await reader.waitForResponse('t0');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('METHOD_NOT_ALLOWED');
    } finally {
      child.kill();
    }
  });

  it('cancel aborts an in-flight request with CANCELLED', async () => {
    const child = await spawnBridge({
      HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')),
      PI_WS_DESKTOP_BRIDGE_TEST_MODE: '1',
    });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('c1', '__test_slow', { ms: 10_000 }) + '\n');
      await new Promise((r) => setTimeout(r, 100));
      child.stdin.write(JSON.stringify({ v: PROTOCOL_VERSION, type: 'cancel', requestId: 'c1' }) + '\n');
      const resp = await reader.waitForResponse('c1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('CANCELLED');
    } finally {
      child.kill();
    }
  });

  it('times out a hung request with BRIDGE_TIMEOUT (client-supplied timeoutMs)', async () => {
    const child = await spawnBridge({
      HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')),
      PI_WS_DESKTOP_BRIDGE_TEST_MODE: '1',
    });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'request',
          requestId: 'k1',
          method: '__test_slow',
          params: { ms: 10_000 },
          timeoutMs: 250,
        }) + '\n',
      );
      const resp = await reader.waitForResponse('k1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('BRIDGE_TIMEOUT');
    } finally {
      child.kill();
    }
  });

  it('answers two concurrent requests with two complete, correctly-correlated frames', async () => {
    const child = await spawnBridge({
      HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')),
      PI_WS_DESKTOP_BRIDGE_TEST_MODE: '1',
    });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('q1', '__test_slow', { ms: 120, tag: 'a' }) + '\n');
      child.stdin.write(req('q2', '__test_slow', { ms: 60, tag: 'b' }) + '\n');      const [r1, r2] = await Promise.all([
        reader.waitForResponse('q1'),
        reader.waitForResponse('q2'),
      ]);
      const raws = JSON.stringify([r1.raw, r2.raw]);
      const d1 = (r1.frame as ResponseOkFrameT).result as { tag: string } | undefined;
      const d2 = (r2.frame as ResponseOkFrameT).result as { tag: string } | undefined;
      expect(d1?.tag, raws).toBe('a');
      expect(d2?.tag, raws).toBe('b');
      for (const f of [r1, r2]) expect(f.frame).not.toBeNull();
    } finally {
      child.kill();
    }
  });

  it('creates no files under HOME (read-only smoke): directory stays empty', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-'));
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('n1', 'health') + '\n');
      await reader.waitForResponse('n1');
    } finally {
      child.kill();
    }
    expect(readdirSync(home)).toEqual([]);
  });

  it('reports a fake pi from PI_WS_DESKTOP_PI in getRuntimeInfo and getCapabilities', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-'));
    const fakePi = makeFakePi(home, true);
    const child = await spawnBridge({ HOME: home, PI_WS_DESKTOP_PI: fakePi });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('i1', 'getRuntimeInfo') + '\n');
      const info = await reader.waitForResponse('i1');
      const data = (info.frame as ResponseOkFrameT).result as {
        pi: { path: string; version: string; rpcSupported: boolean };
      };
      expect(data.pi.path).toBe(fakePi);
      expect(data.pi.version).toBe('9.9.9');
      expect(data.pi.rpcSupported).toBe(true);

      child.stdin.write(req('i2', 'getCapabilities') + '\n');
      const caps = await reader.waitForResponse('i2');
      const capData = (caps.frame as ResponseOkFrameT).result as { methods: string[] };
      expect(capData.methods).toContain('health');
      expect(capData.methods).not.toContain('__test_slow');
    } finally {
      child.kill();
    }
  });

  it('answers PI_INCOMPATIBLE from getCapabilities when the pi build lacks RPC mode', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-'));
    const fakePi = makeFakePi(home, false);
    const child = await spawnBridge({ HOME: home, PI_WS_DESKTOP_PI: fakePi });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('x1', 'getCapabilities') + '\n');
      const resp = await reader.waitForResponse('x1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('PI_INCOMPATIBLE');
    } finally {
      child.kill();
    }
  });

  it('answers PI_NOT_FOUND when no pi exists in HOME or PATH', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-'));
    const child = await spawnBridge({ HOME: home }); // PATH is /usr/bin:/bin only
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('p1', 'getRuntimeInfo') + '\n');
      const resp = await reader.waitForResponse('p1');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('PI_NOT_FOUND');
    } finally {
      child.kill();
    }
  });

  it('exits cleanly when stdin closes (client gone)', async () => {
    const child = await spawnBridge({ HOME: mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-')) });
    const reader = new FrameReader(child.stdout);
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    await reader.waitForEvent('ready');
    child.stdin.end();
    expect(await exited).toBe(0);
  });
});
