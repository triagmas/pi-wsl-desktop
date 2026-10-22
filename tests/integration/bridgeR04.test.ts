/**
 * M3 R04 integration (real bridge subprocess): external declarative manifest
 * discovery. The bridge owns the root — callers pass NO path — and every
 * entry must survive path/name/symlink/size/encoding/JSON guards fail-closed
 * before any raw object reaches the renderer.
 */
import { chmodSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ResponseErrorFrameT, ResponseOkFrameT } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { ListModulesResultSchema, MAX_MODULE_FILE_BYTES } from '../../src/shared/m3Ipc';
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

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'piwsd-r04-home-'));
}

function modulesDir(home: string): string {
  const dir = path.join(home, '.pi-desktop', 'modules');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const VALID_MANIFEST = {
  id: 'alpha',
  version: '1.0.0',
  apiVersion: 1,
  capabilities: ['runtime'],
  ui: [{ kind: 'tab', id: 'a', title: 'Alpha', blocks: [{ type: 'text', value: 'ok' }] }],
};

afterAll(async () => {
  await removeBridgeBundle();
});

describe('M3 R04 bridge — listModules discovery', () => {
  it('case 1: empty home yields an unavailable silent root, no diagnostics', async () => {
    const home = tempHome();
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('d1', 'listModules') + '\n');
      const resp = await reader.waitForResponse('d1');
      expect(resp.frame).toMatchObject({ status: 'ok' });
      const data = (resp.frame as ResponseOkFrameT).result;
      const parsed = ListModulesResultSchema.safeParse(data);
      expect(parsed.success).toBe(true);
      expect(data).toMatchObject({ available: false, files: [], diagnostics: [], state: {} });
      // Privacy (REAL smoke caught it): no absolute home path may cross the
      // bridge→renderer boundary — the bridge-owned location is proven by the
      // manifest fixtures below, not by shipping the path itself.
      expect(JSON.stringify(data).includes(home)).toBe(false);
    } finally {
      child.kill();
    }
  });

  // chmod has no deny-semantics on Windows — the case asserts POSIX EACCES
  // behavior and is honestly reported as skipped there (CI Linux covers it).
  it.runIf(process.platform !== 'win32')(
    'case 11: an unreadable root reports a path-free diagnostic (privacy)',
    async () => {
      const home = tempHome();
      const root = path.join(home, '.pi-desktop', 'modules');
      mkdirSync(root, { recursive: true });
      chmodSync(root, 0o000);
      const child = await spawnBridge({ HOME: home });
      const reader = new FrameReader(child.stdout);
      try {
        await reader.waitForEvent('ready');
        child.stdin.write(req('d11', 'listModules') + '\n');
        const resp = await reader.waitForResponse('d11');
        const data = (resp.frame as ResponseOkFrameT).result as {
          diagnostics: string[];
          available: boolean;
        };
        expect(data.available).toBe(false);
        expect(data.diagnostics.join(' ')).toMatch(/unreadable/i);
        // RED: raw EACCES text carries the absolute path — must be sanitized.
        expect(JSON.stringify(data).includes(home)).toBe(false);
      } finally {
        child.kill();
        chmodSync(root, 0o755);
      }
    },
  );

  it('case 10: listModules rejects any caller-supplied params', async () => {
    const child = await spawnBridge({ HOME: tempHome() });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('d10', 'listModules', { root: '/etc' }) + '\n');
      const resp = await reader.waitForResponse('d10');
      expect((resp.frame as ResponseErrorFrameT).error.code).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }
  });

  it('cases 2-6: valid / symlink / oversized / broken-JSON / schema-invalid files', async () => {
    const home = tempHome();
    const dir = modulesDir(home);
    writeFileSync(path.join(dir, 'alpha.json'), JSON.stringify(VALID_MANIFEST));
    // out-of-root secret the symlink must never expose
    writeFileSync(path.join(home, 'secret.json'), JSON.stringify({ secret: 'LEAK' }));
    symlinkSync(path.join(home, 'secret.json'), path.join(dir, 'link.json'));
    writeFileSync(path.join(dir, 'big.json'), JSON.stringify({ pad: 'x'.repeat(MAX_MODULE_FILE_BYTES + 1024) }));
    writeFileSync(path.join(dir, 'broken.json'), '{"id":');
    writeFileSync(path.join(dir, 'bad-schema.json'), '{"id":1}');

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('d2', 'listModules') + '\n');
      const resp = await reader.waitForResponse('d2');
      expect(resp.frame).toMatchObject({ status: 'ok' });
      const data = (resp.frame as ResponseOkFrameT).result as {
        available: boolean;
        files: Array<{ file: string; status: string; raw?: unknown; errors: string[] }>;
      };
      expect(ListModulesResultSchema.safeParse(data).success).toBe(true);
      expect(data.available).toBe(true);
      const byFile = new Map(data.files.map((f) => [f.file, f]));

      // (2) valid manifest passes through with raw JSON (renderer owns schema)
      expect(byFile.get('alpha.json')).toMatchObject({ status: 'ok' });
      expect((byFile.get('alpha.json')!.raw as { id: string }).id).toBe('alpha');
      // (3) symlink rejected by lstat, content never returned
      expect(byFile.get('link.json')!.status).toBe('error');
      expect(byFile.get('link.json')!.errors.join(' ')).toMatch(/symlink/i);
      // (4) oversized rejected
      expect(byFile.get('big.json')!.status).toBe('error');
      expect(byFile.get('big.json')!.errors.join(' ')).toContain('65536');
      // (5) invalid JSON rejected per-file, fail-closed
      expect(byFile.get('broken.json')!.status).toBe('error');
      expect(byFile.get('broken.json')!.errors.join(' ')).toMatch(/invalid JSON/i);
      // (6) schema-invalid JSON still surfaces as raw for the renderer stage
      expect(byFile.get('bad-schema.json')).toMatchObject({ status: 'ok' });
      expect(byFile.get('bad-schema.json')!.raw).toEqual({ id: 1 });
      // (3) leak check across the WHOLE response
      expect(JSON.stringify(data)).not.toContain('LEAK');
    } finally {
      child.kill();
    }
  });

  it('cases 7-8: caps at 64 files in deterministic lexicographic order', async () => {
    const home = tempHome();
    const dir = modulesDir(home);
    for (let i = 1; i <= 64; i += 1) {
      writeFileSync(path.join(dir, `a${String(i).padStart(2, '0')}.json`), JSON.stringify(VALID_MANIFEST));
    }
    writeFileSync(path.join(dir, '000-extra.json'), JSON.stringify(VALID_MANIFEST));

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('d7', 'listModules') + '\n');
      const resp = await reader.waitForResponse('d7');
      const data = (resp.frame as ResponseOkFrameT).result as {
        files: Array<{ file: string }>;
        diagnostics: string[];
      };
      expect(data.files).toHaveLength(64);
      // the lexicographically FIRST file made the cut; the TAIL was dropped
      expect(data.files[0]!.file).toBe('000-extra.json');
      expect(data.files.some((f) => f.file === 'a64.json')).toBe(false);
      expect(data.diagnostics.join(' ')).toMatch(/limit \(64\)/);
    } finally {
      child.kill();
    }
  });

  it('case 9: an unreadable regular file degrades to a per-file error', async () => {
    const home = tempHome();
    const dir = modulesDir(home);
    const target = path.join(dir, 'nope.json');
    writeFileSync(target, JSON.stringify(VALID_MANIFEST));
    chmodSync(target, 0o000);

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('d9', 'listModules') + '\n');
      const resp = await reader.waitForResponse('d9');
      expect(resp.frame).toMatchObject({ status: 'ok' });
      const data = (resp.frame as ResponseOkFrameT).result as {
        files: Array<{ file: string; status: string; errors: string[] }>;
      };
      const entry = data.files.find((f) => f.file === 'nope.json');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('error');
      expect(entry!.errors.length).toBeGreaterThan(0);
    } finally {
      chmodSync(target, 0o644);
      child.kill();
    }
  });
});

function statePath(home: string): string {
  return path.join(home, '.pi-desktop', 'module-state.json');
}

async function call(
  child: Awaited<ReturnType<typeof spawnBridge>>,
  reader: FrameReader,
  requestId: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: string; result?: unknown; error?: string }> {
  child.stdin.write(req(requestId, method, params) + '\n');
  const resp = await reader.waitForResponse(requestId);
  const frame = resp.frame as ResponseOkFrameT | ResponseErrorFrameT;
  if (frame.type === 'response' && frame.status === 'ok') {
    return { status: 'ok', result: frame.result };
  }
  return { status: 'error', error: (frame as ResponseErrorFrameT).error.code };
}

describe('M3 R04 bridge — setModuleState persistence', () => {
  it('cases 1-2: persists the pair, then merges the next id', async () => {
    const home = tempHome();
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const first = await call(child, reader, 's1', 'setModuleState', { id: 'alpha', enabled: false });
      expect(first).toEqual({ status: 'ok', result: { id: 'alpha', enabled: false } });
      const second = await call(child, reader, 's2', 'setModuleState', { id: 'beta', enabled: true });
      expect(second.status).toBe('ok');

      const doc = JSON.parse(await (await import('node:fs/promises')).readFile(statePath(home), 'utf8'));
      expect(doc.version).toBe(1);
      expect(doc.modules.alpha).toEqual({ enabled: false });
      expect(doc.modules.beta).toEqual({ enabled: true });

      const listed = await call(child, reader, 's3', 'listModules');
      expect(listed.status).toBe('ok');
      expect(listed.result).toMatchObject({
        state: { alpha: false, beta: true },
        diagnostics: [],
      });
    } finally {
      child.kill();
    }
  });

  it('cases 3-4: preserves unknown top-level keys and unknown module fields', async () => {
    const home = tempHome();
    const dir = path.join(home, '.pi-desktop');
    mkdirSync(dir, { recursive: true });
    await (await import('node:fs/promises')).writeFile(
      statePath(home),
      JSON.stringify({ custom: 1, modules: { x: { enabled: true, note: 'keep' } } }),
    );
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const saved = await call(child, reader, 's4', 'setModuleState', { id: 'alpha', enabled: false });
      expect(saved.status).toBe('ok');
      const doc = JSON.parse(await (await import('node:fs/promises')).readFile(statePath(home), 'utf8'));
      expect(doc.custom).toBe(1);
      expect(doc.modules.x).toEqual({ enabled: true, note: 'keep' });
      expect(doc.version).toBe(1);

      const listed = await call(child, reader, 's5', 'listModules');
      expect(listed.result).toMatchObject({ state: { x: true, alpha: false } });
    } finally {
      child.kill();
    }
  });

  it('case 5: traversal ids are rejected before any write', async () => {
    const home = tempHome();
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const bad = await call(child, reader, 's6', 'setModuleState', { id: '../evil', enabled: true });
      expect(bad.error).toBe('INVALID_REQUEST');
      const fsp = await import('node:fs/promises');
      let exists = true;
      try {
        await fsp.stat(statePath(home));
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    } finally {
      child.kill();
    }
  });

  it('case 6: corrupt state fails closed — diagnostics on read, INVALID_REQUEST on write, bytes unchanged', async () => {
    const home = tempHome();
    const dir = path.join(home, '.pi-desktop');
    mkdirSync(dir, { recursive: true });
    const fsp = await import('node:fs/promises');
    await fsp.writeFile(statePath(home), '{"version":1,"modules":{"alpha":');
    const before = await fsp.readFile(statePath(home), 'utf8');

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const listed = await call(child, reader, 's7', 'listModules');
      expect(listed.status).toBe('ok');
      const result = listed.result as { state: Record<string, boolean>; diagnostics: string[] };
      expect(result.state).toEqual({});
      expect(result.diagnostics.join(' ')).toMatch(/state/i);

      const written = await call(child, reader, 's8', 'setModuleState', { id: 'alpha', enabled: false });
      expect(written.error).toBe('INVALID_REQUEST');
      expect(await fsp.readFile(statePath(home), 'utf8')).toBe(before);
    } finally {
      child.kill();
    }
  });

  it('case 7: a symlinked state file is rejected and its target untouched', async () => {
    const home = tempHome();
    const dir = path.join(home, '.pi-desktop');
    mkdirSync(dir, { recursive: true });
    const fsp = await import('node:fs/promises');
    const target = path.join(home, 'target-state.json');
    await fsp.writeFile(target, JSON.stringify({ version: 1, modules: {} }));
    await symlinkSync(target, statePath(home));
    const before = await fsp.readFile(target, 'utf8');

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const written = await call(child, reader, 's9', 'setModuleState', { id: 'alpha', enabled: false });
      expect(written.error).toBe('INVALID_REQUEST');
      expect(await fsp.readFile(target, 'utf8')).toBe(before);
      const linkStat = await fsp.lstat(statePath(home));
      expect(linkStat.isSymbolicLink()).toBe(true);
    } finally {
      child.kill();
    }
  });

  it('case 7b: a symlinked .pi-desktop directory refuses writes', async () => {
    const home = tempHome();
    const outside = mkdtempSync(path.join(os.tmpdir(), 'piwsd-r04-outside-'));
    symlinkSync(outside, path.join(home, '.pi-desktop'));

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const written = await call(child, reader, 's10', 'setModuleState', { id: 'alpha', enabled: false });
      expect(written.error).toBe('INVALID_REQUEST');
      const fsp = await import('node:fs/promises');
      let leaked = true;
      try {
        await fsp.stat(path.join(outside, 'module-state.json'));
      } catch {
        leaked = false;
      }
      expect(leaked).toBe(false);
    } finally {
      child.kill();
    }
  });

  it('case 8: parallel writes serialize — both ids survive', async () => {
    const home = tempHome();
    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const [a, b] = await Promise.all([
        call(child, reader, 's11', 'setModuleState', { id: 'alpha', enabled: false }),
        call(child, reader, 's12', 'setModuleState', { id: 'beta', enabled: true }),
      ]);
      expect(a.status).toBe('ok');
      expect(b.status).toBe('ok');
      const fsp = await import('node:fs/promises');
      const doc = JSON.parse(await fsp.readFile(statePath(home), 'utf8'));
      expect(doc.modules.alpha).toEqual({ enabled: false });
      expect(doc.modules.beta).toEqual({ enabled: true });
    } finally {
      child.kill();
    }
  });

  it('case 11: a NEW id is refused once the state holds 512 entries', async () => {
    const home = tempHome();
    const dir = path.join(home, '.pi-desktop');
    mkdirSync(dir, { recursive: true });
    const fsp = await import('node:fs/promises');
    const modules: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < 512; i += 1) modules[`m${i}`] = { enabled: true };
    await fsp.writeFile(statePath(home), JSON.stringify({ version: 1, modules }));

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const refused = await call(child, reader, 's13', 'setModuleState', { id: 'alpha', enabled: false });
      expect(refused.error).toBe('INVALID_REQUEST');
      // rewriting an EXISTING id at the cap stays allowed (no growth)
      const rewrite = await call(child, reader, 's14', 'setModuleState', { id: 'm0', enabled: false });
      expect(rewrite.status).toBe('ok');
    } finally {
      child.kill();
    }
  });

  it('case 13: an oversized state file is ignored on read and refused on write', async () => {
    const home = tempHome();
    const dir = path.join(home, '.pi-desktop');
    mkdirSync(dir, { recursive: true });
    const fsp = await import('node:fs/promises');
    await fsp.writeFile(statePath(home), `{"version":1,"modules":{},"pad":"${'x'.repeat(300_000)}"}`);

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const listed = await call(child, reader, 's15', 'listModules');
      const result = listed.result as { state: Record<string, boolean>; diagnostics: string[] };
      expect(result.state).toEqual({});
      expect(result.diagnostics.join(' ')).toMatch(/state/i);
      const written = await call(child, reader, 's16', 'setModuleState', { id: 'alpha', enabled: false });
      expect(written.error).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }
  });

  it('case 12: a symlinked .pi-desktop disables discovery (realpath containment)', async () => {
    const home = tempHome();
    const outside = mkdtempSync(path.join(os.tmpdir(), 'piwsd-r04-disc-'));
    mkdirSync(path.join(outside, 'modules'), { recursive: true });
    writeFileSync(path.join(outside, 'modules', 'sneaky.json'), JSON.stringify(VALID_MANIFEST));
    symlinkSync(outside, path.join(home, '.pi-desktop'));

    const child = await spawnBridge({ HOME: home });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      const listed = await call(child, reader, 's17', 'listModules');
      const result = listed.result as { available: boolean; files: unknown[]; diagnostics: string[] };
      expect(result.available).toBe(false);
      expect(result.files).toEqual([]);
      expect(result.diagnostics.join(' ')).toMatch(/escapes the home directory/);
      expect(JSON.stringify(result)).not.toContain('sneaky');
    } finally {
      child.kill();
    }
  });
});
