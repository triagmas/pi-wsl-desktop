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

  it('rejects duplicate ui entry ids inside one manifest (colliding tabKeys)', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      ui: [
        { kind: 'tab', id: 'welcome', title: 'A', blocks: validBlockList },
        { kind: 'tab', id: 'welcome', title: 'B', blocks: validBlockList },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('manifest');
      expect(result.errors.join(' ')).toMatch(/duplicate ui id/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/* M3 R03 — declarative contract: actions whitelist, versioned deps    */
/* ------------------------------------------------------------------ */
import * as m3 from '../../src/shared/m3Protocol';

describe('M3 R03 contract — actions, versioned dependencies', () => {
  it('accepts declarative actions whose operation is on the explicit whitelist', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      actions: [
        { id: 'go', title: 'Открыть вкладку', operation: 'openTab' },
        { id: 'reload', title: 'Обновить', operation: 'refresh' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.actions).toHaveLength(2);
      expect(result.manifest.actions[0]).toMatchObject({ id: 'go', operation: 'openTab' });
    }
  });

  it('rejects an action whose operation is NOT whitelisted (fail closed)', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      actions: [{ id: 'drop', title: 'Снести базу', operation: 'dropDatabase' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('manifest');
      expect(result.errors.join(' ')).toMatch(/operation/i);
    }
  });

  it('keeps the R01 string dependency form working unchanged (back-compat)', () => {
    const result = parseModuleManifest({ ...validManifest(), dependencies: ['other'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.dependencies).toEqual(['other']);
  });

  it('accepts an object dependency with a semver range', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      dependencies: [{ id: 'provider', range: '^1.0.0' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.dependencies).toEqual([{ id: 'provider', range: '^1.0.0' }]);
  });

  it('rejects an unusable dependency range', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      dependencies: [{ id: 'provider', range: 'definitely not a range' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('manifest');
  });

  it('exposes a whitelist and a semver-range helper', () => {
    expect(Array.isArray(m3.MODULE_OPERATIONS)).toBe(true);
    const fn = (m3 as Record<string, unknown>).satisfiesSemverRange;
    expect(typeof fn).toBe('function');
    if (typeof fn === 'function') {
      const sat = fn as (version: string, range: string) => boolean;
      expect(sat('1.2.3', '^1.0.0')).toBe(true);
      expect(sat('2.0.0', '^1.0.0')).toBe(false);
      expect(sat('1.2.3', '1.2.3')).toBe(true);
      expect(sat('1.2.4', '1.2.3')).toBe(false);
      expect(sat('9.9.9', '*')).toBe(true);
    }
  });
});

describe('M3 R03 contract — action target', () => {
  it('accepts an optional target for operations that need one', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      actions: [{ id: 'go', title: 'Открыть', operation: 'openTab', target: 'demo/welcome' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.actions[0]).toMatchObject({ target: 'demo/welcome' });
  });

  it('accepts an action without a target (target is optional)', () => {
    const result = parseModuleManifest({
      ...validManifest(),
      actions: [{ id: 'reload', title: 'Обновить', operation: 'refresh' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.actions[0]).not.toHaveProperty('target');
  });
});

describe('M3 R03 contract — pre-release range resolution', () => {
  it('never lets a pre-release satisfy an exact release range (semver precedence)', () => {
    const sat = (m3 as Record<string, unknown>).satisfiesSemverRange as (
      version: string,
      range: string,
    ) => boolean;
    // 1.0.0-beta.1 < 1.0.0 — an exact "1.0.0" requirement must not accept it
    expect(sat('1.0.0-beta.1', '1.0.0')).toBe(false);
    // an exact pre-release range only accepts that exact pre-release
    expect(sat('1.0.0-beta.2', '1.0.0-beta.1')).toBe(false);
    expect(sat('1.0.0-beta.1', '1.0.0-beta.1')).toBe(true);
  });
});

describe('M3 R04 — semver range correctness (P2)', () => {
  const sat = (m3 as Record<string, unknown>).satisfiesSemverRange as (
    version: string,
    range: string,
  ) => boolean;

  it('bounds caret ranges for 0.x versions (node-semver ^0.y.z semantics)', () => {
    expect(sat('0.3.0', '^0.2.3')).toBe(false);
    expect(sat('0.2.9', '^0.2.3')).toBe(true);
    expect(sat('0.0.4', '^0.0.3')).toBe(false);
    expect(sat('0.0.3', '^0.0.3')).toBe(true);
  });

  it('applies the prerelease-tuple rule to caret ranges', () => {
    // node-semver: a prerelease may only satisfy a comparator whose
    // major.minor.patch tuple matches its own — 1.1.0-beta.1 must NOT pass
    // ^1.0.0-beta.1, but a newer pre-release of 1.0.0 does.
    expect(sat('1.1.0-beta.1', '^1.0.0-beta.1')).toBe(false);
    expect(sat('1.0.0-beta.2', '^1.0.0-beta.1')).toBe(true);
    expect(sat('1.0.0', '^1.0.0-beta.1')).toBe(true);
  });

  it('compares numeric identifiers beyond 2^53 without precision loss', () => {
    // exact: identity must differ (Number() collapses both to 9007199254740992)
    expect(sat('9007199254740993.0.0', '9007199254740992.0.0')).toBe(false);
    expect(sat('9007199254740992.0.0', '9007199254740993.0.0')).toBe(false);
    expect(sat('9007199254740993.0.0', '9007199254740993.0.0')).toBe(true);
    // caret: node-semver bounds — a differing MAJOR is outside `^base`,
    // while a differing MINOR within the same MAJOR must compare exactly.
    expect(sat('9007199254740993.0.0', '^9007199254740992.0.0')).toBe(false);
    expect(sat('9007199254740992.9007199254740993.0', '^9007199254740992.9007199254740992.0')).toBe(true);
    expect(sat('9007199254740992.9007199254740992.0', '^9007199254740992.9007199254740993.0')).toBe(false);
    // pre-release numeric ids compare numerically, not as rounded doubles
    expect(sat('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBe(false);
    expect(sat('1.0.0-9007199254740993', '^1.0.0-9007199254740992')).toBe(true);
  });
});
