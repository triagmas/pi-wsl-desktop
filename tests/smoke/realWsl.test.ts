/**
 * REAL Windows+WSL smoke — local only, never part of CI claims.
 *
 * Run: `npm run test:smoke:real` (sets REAL_WSL=1). Without the env var the
 * suite reports SKIP — a skipped smoke is NOT a passed smoke.
 *
 * Exercises: real wsl.exe (UTF-16 output), real Ubuntu distribution, real
 * node discovery via ~/.local/bin, the real bundled bridge over wsl.exe
 * stdio, real Pi probe (version + RPC capability) and a no-mutation check
 * on the user's Pi settings metadata (sessions/ and lock files excluded —
 * this very Pi session keeps writing them).
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/main/bridgeClient';
import { WslConnection } from '../../src/main/connection';
import { listDistros, probeNode, startBridgeProcess } from '../../src/main/wsl';

const REAL = process.env.REAL_WSL === '1';
const repoRoot = path.join(__dirname, '..', '..');
const bridgeBundle = path.join(repoRoot, 'dist', 'bridge', 'index.cjs');

/**
 * This smoke runs on the WSL side of the same PC: it drives the real
 * Windows wsl.exe through its interop path. On a native Windows host the
 * default `C:\Windows\System32\wsl.exe` applies (the Windows GUI smoke).
 */
const wslPath =
  process.platform === 'win32'
    ? undefined
    : '/mnt/c/Windows/System32/wsl.exe';

/** Metadata snapshot of stable Pi config files (content is never printed). */
function piConfigMeta(): Record<string, { size: number; mtimeMs: number }> {
  const dir = path.join(process.env.HOME ?? '', '.pi', 'agent');
  const meta: Record<string, { size: number; mtimeMs: number }> = {};
  for (const name of ['settings.json', 'trust.json', 'auth.json', 'mcp.json']) {
    const file = path.join(dir, name);
    if (existsSync(file)) {
      const st = statSync(file);
      meta[name] = { size: st.size, mtimeMs: st.mtimeMs };
    }
  }
  return meta;
}

describe.runIf(REAL)('REAL WSL smoke (REAL_WSL=1)', () => {
  it('lists the real distribution via wsl.exe (UTF-16 aware)', async () => {
    const distros = await listDistros({ wslPath, timeoutMs: 15_000 });
    expect(distros.length).toBeGreaterThan(0);
    expect(distros.every((d) => d.trim() === d && d.length > 0)).toBe(true);
  });

  it('probes real node and the bridge bundle inside the default distribution', async () => {
    const distros = await listDistros({ wslPath, timeoutMs: 15_000 });
    const probe = await probeNode({
      wslPath,
      distro: distros[0],
      bridgeWslPath: bridgeBundle,
      timeoutMs: 15_000,
    });
    expect(probe.ok).toBe(true);
    expect(probe.nodePath).toBeTruthy();
    expect(probe.nodeVersion).toMatch(/^v\d+/);
    expect(probe.bridgeOk).toBe(true);
  });

  it('runs the real bridge and reports the installed Pi read-only without mutating config', async () => {
    const before = piConfigMeta();
    const distros = await listDistros({ wslPath, timeoutMs: 15_000 });
    const probe = await probeNode({
      wslPath,
      distro: distros[0],
      bridgeWslPath: bridgeBundle,
      timeoutMs: 15_000,
    });
    expect(probe.ok).toBe(true);
    expect(probe.nodePath).toBeTruthy();

    const child = startBridgeProcess({
      wslPath,
      distro: distros[0],
      nodePath: probe.nodePath!,
      bridgeWslPath: bridgeBundle,
    });
    const client = new BridgeClient({ spawn: () => child, requestTimeoutMs: 30_000 });
    const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));
    client.connect();
    await ready;

    const health = (await client.request('health')) as { status: string; protocolVersion: number };
    expect(health.status).toBe('ok');

    const runtime = (await client.request('getRuntimeInfo')) as {
      node: { version: string };
      pi: { version: string; rpcSupported: boolean };
    };
    expect(runtime.node.version).toMatch(/^v\d+/);
    expect(runtime.pi.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(runtime.pi.rpcSupported).toBe(true);

    const caps = (await client.request('getCapabilities')) as { methods: string[] };
    expect(caps.methods).toContain('health');
    expect(caps.methods).not.toContain('__test_slow');

    client.close();
    await new Promise((r) => setTimeout(r, 500));

    const after = piConfigMeta();
    expect(after).toEqual(before); // read-only: no config file changed size/mtime
  });

  it('connects the full Desktop-side stack (WslConnection) against the real environment', async () => {
    const conn = new WslConnection({
      wslPath,
      bridgeWinPath: path.join(repoRoot, 'dist', 'main', '..', 'bridge', 'index.cjs'),
      timeouts: { listMs: 15_000, probeMs: 15_000, readyMs: 20_000, requestMs: 30_000 },
    });
    conn.start();
    const deadline = Date.now() + 40_000;
    while (conn.snapshot().phase !== 'ready' && Date.now() < deadline) {
      if (conn.snapshot().phase === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const snap = conn.snapshot();
    expect(snap.phase).toBe('ready');
    const runtime = snap.runtime as { pi: { version: string } } | null;
    expect(runtime?.pi.version).toMatch(/^\d+\.\d+\.\d+/);
    conn.close();
  });
});

describe.runIf(!REAL)('REAL WSL smoke', () => {
  it.skip('skipped: run npm run test:smoke:real on the Windows+WSL host (NOT RUN is not PASS)', () => {
    expect(true).toBe(true);
  });
});
