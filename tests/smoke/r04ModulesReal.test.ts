/**
 * REAL Windows+WSL smoke for M3 R04 (external discovery + persistence) —
 * local only, never part of CI claims.
 *
 * Run: `npm run test:smoke:real` (sets REAL_WSL=1). Without the env var the
 * suite reports SKIP — a skipped smoke is NOT a passed smoke.
 *
 * Exercises against the REAL bridge on the real home: capability advertisement,
 * the typed `listModules` contract (schema check, strict params rejection) and
 * a no-mutation check on `$HOME/.pi-desktop` — discovery is read-only: it must
 * not create the modules root nor the state file. `setModuleState` is
 * deliberately NOT exercised here: a write to the user's real home is owner-
 * gated and covered only by fixture-backed tests.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/main/bridgeClient';
import { listDistros, probeNode, startBridgeProcess } from '../../src/main/wsl';
import { ListModulesResultSchema } from '../../src/shared/m3Ipc';

const REAL = process.env.REAL_WSL === '1';
const repoRoot = path.join(__dirname, '..', '..');
const bridgeBundle = path.join(repoRoot, 'dist', 'bridge', 'index.cjs');
const wslPath =
  process.platform === 'win32'
    ? undefined
    : '/mnt/c/Windows/System32/wsl.exe';

describe.runIf(REAL)('REAL WSL M3 R04 smoke (REAL_WSL=1)', () => {
  it('advertises the typed M3 methods and runs listModules read-only against the real home', async () => {
    const home = process.env.HOME ?? '';
    const piDesktopDir = path.join(home, '.pi-desktop');
    const stateFile = path.join(piDesktopDir, 'module-state.json');
    const dirExisted = existsSync(piDesktopDir);
    const stateMeta = existsSync(stateFile) ? statSync(stateFile) : null;

    const distros = await listDistros({ wslPath, timeoutMs: 15_000 });
    const probe = await probeNode({
      wslPath,
      distro: distros[0],
      bridgeWslPath: bridgeBundle,
      timeoutMs: 15_000,
    });
    expect(probe.ok).toBe(true);
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

    const caps = (await client.request('getCapabilities')) as { methods: string[] };
    expect(caps.methods).toContain('listModules');
    expect(caps.methods).toContain('setModuleState');

    // Typed contract: strict `{}` params — anything else is a Zod rejection.
    await expect(client.request('listModules', { path: '../../etc' })).rejects.toThrow(
      /Unrecognized key/,
    );

    const result = await client.request('listModules');
    const parsed = ListModulesResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // No absolute home paths may leak into the renderer-bound payload.
      const serialized = JSON.stringify(parsed.data);
      if (serialized.includes(`${home}/`)) {
        const i = serialized.indexOf(`${home}/`);
        console.log('LEAK CONTEXT:', serialized.slice(Math.max(0, i - 200), i + 240));
      }
      expect(serialized.includes(`${home}/`)).toBe(false);
      expect(parsed.data.files.length).toBeLessThanOrEqual(64);
      expect(parsed.data.diagnostics.length).toBeLessThanOrEqual(64);
    }

    client.close();
    await new Promise((r) => setTimeout(r, 500));

    // Read-only: discovery must not create `.pi-desktop`, nor the state file,
    // nor touch either when they already exist.
    expect(existsSync(piDesktopDir)).toBe(dirExisted);
    if (stateMeta !== null) {
      const after = statSync(stateFile);
      expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
        size: stateMeta.size,
        mtimeMs: stateMeta.mtimeMs,
      });
    } else {
      expect(existsSync(stateFile)).toBe(false);
    }
  });
});

describe.runIf(!REAL)('REAL WSL M3 R04 smoke', () => {
  it.skip('skipped: run npm run test:smoke:real on the Windows+WSL host (NOT RUN is not PASS)', () => {
    expect(true).toBe(true);
  });
});
