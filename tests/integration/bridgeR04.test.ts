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
    const child = await spawnBridge({ HOME: tempHome() });
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
      expect((data as { root: string }).root.endsWith('.pi-desktop/modules')).toBe(true);
    } finally {
      child.kill();
    }
  });

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
