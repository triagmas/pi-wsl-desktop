import { mkdtempSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/main/bridgeClient';

const FAKE_BRIDGE = path.join(__dirname, '..', 'fixtures', 'fake-bridge.cjs');

function makeClient(mode: string, logFile?: string, extraEnv: Record<string, string> = {}): BridgeClient {
  return new BridgeClient({
    spawn: () =>
      spawn(process.execPath, [FAKE_BRIDGE], {
        env: {
          PATH: '/usr/bin:/bin',
          FAKE_BRIDGE_MODE: mode,
          ...(logFile ? { FAKE_BRIDGE_LOG: logFile } : {}),
          ...extraEnv,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    requestTimeoutMs: 2000,
  });
}

describe('BridgeClient (real subprocess, fake bridge)', () => {
  it('connects, surfaces ready and resolves a health request', async () => {
    const client = makeClient('ok');
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;
    const result = (await client.request('health')) as { fixture: boolean; tag: string | null };
    expect(result.fixture).toBe(true);
    expect(result.tag).toBeNull();
    client.close();
  });

  it('rejects requests when not connected', async () => {
    const client = makeClient('ok');
    await expect(client.request('health')).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('times out a silent bridge with BRIDGE_TIMEOUT and sends a cancel frame', async () => {
    const log = path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-log-')), 'bridge.log');
    const client = makeClient('silent', log);
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;
    await expect(client.request('health', {}, { timeoutMs: 250 })).rejects.toMatchObject({
      code: 'BRIDGE_TIMEOUT',
    });
    await new Promise((r) => setTimeout(r, 100));
    const logText = readFileSync(log, 'utf8');
    expect(logText).toMatch(/cancel:[\w-]+/);
    client.close();
  });

  it('rejects a manually cancelled request with CANCELLED', async () => {
    const client = makeClient('silent');
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;
    const { requestId, response } = client.send('health', {}, { timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(client.cancel(requestId)).toBe(true);
    await expect(response).rejects.toMatchObject({ code: 'CANCELLED' });
    client.close();
  });

  it('rejects pending requests with DISCONNECTED when the bridge dies mid-request', async () => {
    const client = makeClient('die-on-request');
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    const lost = new Promise<{ reason: string }>((resolve) => client.on('lost', resolve));
    client.connect();
    await ready;
    await expect(client.request('health', {}, { timeoutMs: 10_000 })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
    expect((await lost).reason).toBeTruthy();
    client.close();
  });

  it('destroys the connection on an oversized frame from the bridge', async () => {
    const client = makeClient('oversize');
    const lost = new Promise<{ reason: string }>((resolve) => client.on('lost', resolve));
    client.connect();
    expect((await lost).reason).toContain('overflow');
  });

  it('destroys the connection after repeated invalid frames', async () => {
    const client = makeClient('garbage');
    const lost = new Promise<{ reason: string }>((resolve) => client.on('lost', resolve));
    client.connect();
    expect((await lost).reason).toContain('protocol');
  });

  it('close() kills the child and rejects pending requests', async () => {
    let child: ReturnType<typeof spawn> | null = null;
    const client = new BridgeClient({
      spawn: () => {
        child = spawn(process.execPath, [FAKE_BRIDGE], {
          env: { PATH: '/usr/bin:/bin', FAKE_BRIDGE_MODE: 'silent' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return child as never;
      },
      requestTimeoutMs: 2000,
    });
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;
    const pending = client.request('health', {}, { timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 50));
    const exited = new Promise<number | null>((resolve) => child!.once('exit', (code) => resolve(code)));
    client.close();
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    // orphan prevention: the child must actually terminate (Review Focus 4)
    await expect(exited).resolves.not.toBeNull();
    await expect(client.request('health')).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  // UI21 F1-B R02 (P1): без бюджета в кадре bridge применял свой дефолт 10 000 мс
  // и превращал успешный медленный ACK в BRIDGE_TIMEOUT.
  it('передаёт бюджет обработчика в кадре запроса и переживает ответ дольше 10 c', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'f1br02-'));
    const logFile = path.join(dir, 'frames.log');
    const client = makeClient('slow', logFile, { FAKE_BRIDGE_DELAY_MS: '11000' });
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;
    // внешний тайм-аут 20 c: bridge получает 15 c и обязан успеть ответить
    const result = (await client.request('sendPrompt', undefined, { timeoutMs: 20_000 })) as {
      sawBudget: number | null;
    };
    expect(result.sawBudget).toBe(15_000);
    const frames = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('frame:'))
      .map((l) => JSON.parse(l.slice(6)) as { method: string; timeoutMs?: number });
    const sent = frames.find((f) => f.method === 'sendPrompt');
    expect(sent?.timeoutMs).toBe(15_000);
    client.close();
  }, 40_000);

  it('читающий запрос уходит в bridge с прежним бюджетом 10 000 мс', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'f1br02-read-'));
    const logFile = path.join(dir, 'frames.log');
    const client = makeClient('ok', logFile);
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;
    await client.request('health');
    const frames = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('frame:'))
      .map((l) => JSON.parse(l.slice(6)) as { method: string; timeoutMs?: number });
    expect(frames.find((f) => f.method === 'health')?.timeoutMs).toBe(10_000);
    client.close();
  });
});
