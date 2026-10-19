import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WslConnection } from '../../src/main/connection';

const FAKE_WSL = path.join(__dirname, '..', 'fixtures', 'fake-wsl');
const FAKE_BRIDGE = path.join(__dirname, '..', 'fixtures', 'fake-bridge.cjs');

function tmpLog(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-log-')), 'wsl.log');
}

interface Harness {
  conn: WslConnection;
  log: string;
  env: Record<string, string>;
}

function makeConn(overrides: Record<string, string> = {}, maxAutoAttempts = 2): Harness {
  const log = tmpLog();
  const env: Record<string, string> = {
    FAKE_WSL_LOG: log,
    FAKE_WSL_PROBE_JSON: JSON.stringify({
      ok: true,
      nodePath: process.execPath,
      nodeVersion: process.version,
      home: '/home/fake',
      bridgeOk: true,
    }),
    ...overrides,
  };
  const conn = new WslConnection({
    bridgeWinPath: FAKE_BRIDGE,
    wslPath: FAKE_WSL,
    env,
    maxAutoAttempts,
    backoffMs: [50, 50, 50],
    timeouts: { listMs: 3000, probeMs: 500, readyMs: 400, requestMs: 2000 },
  });
  return { conn, log, env };
}

async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('WslConnection (full fake stack)', () => {
  it('reaches ready with runtime info and serves a health request', async () => {
    const { conn } = makeConn();
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 8000, 'ready');
    const snap = conn.snapshot();
    expect((snap.runtime as { pi: { version: string } }).pi.version).toBe('9.9.9');
    const health = (await conn.request('health')) as { fixture: boolean };
    expect(health.fixture).toBe(true);
    conn.close();
  });

  it('gives up after maxAutoAttempts on hanging probes and lands in error', async () => {
    const { conn, log } = makeConn({ FAKE_WSL_PROBE_MODE: 'hang' }, 2);
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'error', 8000, 'error');
    expect(conn.snapshot().attempt).toBe(2);
    const probes = readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('/bin/sh'));
    expect(probes.length).toBe(2);
    conn.close();
  });

  it('auto-reconnects after the bridge dies and becomes ready again', async () => {
    const { conn, log } = makeConn({ FAKE_BRIDGE_MODE: 'die-after-ready' }, 3);
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 8000, 'first ready');
    const countExec = () => readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('[/usr/bin/env]')).length;
    await waitFor(() => countExec() >= 2, 8000, 'respawned');
    await waitFor(() => conn.snapshot().phase === 'ready', 8000, 'ready again');
    expect(countExec()).toBeGreaterThanOrEqual(2);
    conn.close();
  });

  it('times out a never-ready bridge and retries with backoff', async () => {
    const { conn } = makeConn({ FAKE_BRIDGE_MODE: 'never-ready' }, 2);
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'error', 10_000, 'error after retries');
    conn.close();
  });

  it('selectDistro restarts the stack against the new distro', async () => {
    const { conn, log } = makeConn({}, 2);
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 8000, 'ready');
    conn.selectDistro('Ubuntu中文');
    await waitFor(() => conn.snapshot().phase === 'ready' && conn.snapshot().distro === 'Ubuntu中文', 8000, 'ready on new distro');
    const argv = readFileSync(log, 'utf8');
    expect(argv).toContain('[-d] [Ubuntu中文]');
    conn.close();
  });

  it('listDistros surface distro choices in the snapshot', async () => {
    const { conn } = makeConn();
    const distros = await conn.listDistros();
    expect(distros).toEqual(['Ubuntu', 'Ubuntu中文']);
    conn.close();
  });

  it('close() stops all activity without throwing', async () => {
    const { conn } = makeConn();
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 8000, 'ready');
    conn.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(conn.snapshot().phase).not.toBe('ready');
    await expect(conn.request('health')).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('ready-gate: bridge live but Pi missing → error PI_NOT_FOUND, never a false READY', async () => {
    const { conn } = makeConn({ PI_WS_DESKTOP_PI: path.join(os.tmpdir(), 'definitely-missing-pi-9f3a') });
    conn.start();
    await waitFor(() => ['ready', 'error'].includes(conn.snapshot().phase), 8000, 'settled');
    const snap = conn.snapshot();
    expect(snap.phase).toBe('error');
    expect(snap.lastError?.code).toBe('PI_NOT_FOUND');
    expect(snap.runtime).toBeFalsy();
    // the stack must be torn down — no stale bridge process serves requests
    await expect(conn.request('health')).rejects.toMatchObject({ code: 'DISCONNECTED' });
    conn.close();
  });

  it('ready-gate: pi without advertised RPC → error PI_INCOMPATIBLE, never READY', async () => {
    const { conn } = makeConn({
      PI_WS_DESKTOP_PI: path.join(__dirname, '..', 'fixtures', 'fakepi-norpc'),
    });
    conn.start();
    await waitFor(() => ['ready', 'error'].includes(conn.snapshot().phase), 8000, 'settled');
    const snap = conn.snapshot();
    expect(snap.phase).toBe('error');
    expect(snap.lastError?.code).toBe('PI_INCOMPATIBLE');
    expect(snap.runtime).toBeFalsy();
    await expect(conn.request('health')).rejects.toMatchObject({ code: 'DISCONNECTED' });
    conn.close();
  });
});
