/**
 * M3 contract: versioned module manifest + capability check (SPECIFICATION §5).
 * Fail-closed parse — malformed input never reaches the registry as a shape
 * it did not declare, and apiVersion incompatibility is a distinct stage so
 * the UI can show a reason instead of crashing.
 */
import { describe, expect, it } from 'vitest';
import { MODULE_API_VERSION, parseModuleManifest } from '../../src/shared/m3Protocol';

const validBlockList = [
  { type: 'text', value: 'Демо-модуль подтверждает цикл регистрации' },
  {
    type: 'kv',
    entries: [
      { key: 'Манифест', value: 'demo@1.0.0' },
      { key: 'API', value: '1' },
    ],
  },
  { type: 'list', items: ['Регистрация', 'Включение', 'Отключение'] },
];

function validManifest() {
  return {
    id: 'demo',
    version: '1.0.0',
    apiVersion: MODULE_API_VERSION,
    capabilities: ['runtime'],
    ui: [{ kind: 'tab', id: 'welcome', title: 'Демо-модуль', blocks: validBlockList }],
    dependencies: [],
    params: {},
  };
}

describe('module manifest contract', () => {
  it('accepts a valid versioned manifest and fills defaults', () => {
    const raw = {
      id: 'demo',
      version: '1.0.0',
      apiVersion: MODULE_API_VERSION,
      capabilities: ['runtime'],
      ui: [{ kind: 'tab', id: 'welcome', title: 'Демо-модуль', blocks: validBlockList }],
    };
    const result = parseModuleManifest(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('demo');
      expect(result.manifest.dependencies).toEqual([]);
      expect(result.manifest.params).toEqual({});
      expect(result.manifest.ui).toHaveLength(1);
      expect(result.manifest.ui[0]!.blocks).toHaveLength(3);
    }
  });

  it('rejects non-object input at the manifest stage', () => {
    for (const raw of [null, undefined, 'demo', 42, []]) {
      const result = parseModuleManifest(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.stage).toBe('manifest');
    }
  });

  it('rejects a missing or malformed id at the manifest stage', () => {
    const noId = { ...validManifest() } as Record<string, unknown>;
    delete noId.id;
    expect(parseModuleManifest(noId)).toMatchObject({ ok: false, stage: 'manifest' });

    expect(parseModuleManifest({ ...validManifest(), id: 'Bad Id!' })).toMatchObject({
      ok: false,
      stage: 'manifest',
    });
  });

  it('rejects a non-semver version at the manifest stage', () => {
    expect(parseModuleManifest({ ...validManifest(), version: '1.0' })).toMatchObject({
      ok: false,
      stage: 'manifest',
    });
  });

  it('reports apiVersion incompatibility as its own stage with a reason', () => {
    const result = parseModuleManifest({ ...validManifest(), apiVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('compatibility');
      expect(result.errors.join(' ')).toMatch(/apiVersion/i);
    }
  });

  it('rejects an unknown capability at the manifest stage', () => {
    const result = parseModuleManifest({ ...validManifest(), capabilities: ['teleport'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('manifest');
  });

  it('rejects an unknown UI block type at the manifest stage', () => {
    const manifest = validManifest();
    (manifest.ui[0] as { blocks: unknown[] }).blocks = [{ type: 'chart', data: [] }];
    expect(parseModuleManifest(manifest)).toMatchObject({ ok: false, stage: 'manifest' });
  });

  it('rejects an empty ui list at the manifest stage', () => {
    expect(parseModuleManifest({ ...validManifest(), ui: [] })).toMatchObject({
      ok: false,
      stage: 'manifest',
    });
  });
});
