/**
 * M3 unit: module registry — registration, enable/disable, tab projection.
 * The registry never throws and never lets an invalid/incompatible/duplicate
 * module reach the renderer's tab list.
 */
import { describe, expect, it } from 'vitest';
import { MODULE_API_VERSION } from '../../src/shared/m3Protocol';
import {
  moduleTabs,
  registerModules,
  setModuleEnabled,
} from '../../src/renderer/modules/registry';

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    version: '1.0.0',
    apiVersion: MODULE_API_VERSION,
    capabilities: ['runtime'],
    ui: [
      {
        kind: 'tab',
        id: 'welcome',
        title: 'Демо-модуль',
        blocks: [{ type: 'text', value: 'Цикл регистрации' }],
      },
    ],
    ...overrides,
  };
}

describe('module registry', () => {
  it('registers a valid manifest as enabled with a typed manifest', () => {
    const entries = registerModules([validRaw()]);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.state).toBe('enabled');
    expect(entry.id).toBe('demo');
    expect(entry.manifest?.version).toBe('1.0.0');
    expect(entry.errors).toEqual([]);
  });

  it('records a non-object raw as invalid without throwing', () => {
    const entries = registerModules([null]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state).toBe('invalid');
    expect(entries[0]!.id).toBe('unknown');
    expect(entries[0]!.errors.length).toBeGreaterThan(0);
  });

  it('records an apiVersion-incompatible module as incompatible', () => {
    const entries = registerModules([validRaw({ apiVersion: 99 })]);
    expect(entries[0]!.state).toBe('incompatible');
    expect(entries[0]!.errors.join(' ')).toMatch(/apiVersion/i);
  });

  it('keeps the first registration on duplicate id and fails the second closed', () => {
    const entries = registerModules([validRaw(), validRaw()]);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.state).toBe('enabled');
    expect(entries[1]!.state).toBe('invalid');
    expect(entries[1]!.errors.join(' ')).toMatch(/duplicate id/i);
  });

  it('isolates every malformed form alongside a valid module (Review Focus #1)', () => {
    const entries = registerModules([
      validRaw(), // valid → enabled
      { ...validRaw(), version: '1.0' }, // bad version → invalid
      { ...validRaw(), id: undefined }, // missing id → invalid
      'not-an-object', // non-object → invalid
    ]);
    expect(entries.map((e) => e.state)).toEqual(['enabled', 'invalid', 'invalid', 'invalid']);
    // the valid module still owns exactly its one tab; nothing malformed leaks
    expect(moduleTabs(entries).map((t) => t.tabKey)).toEqual(['demo/welcome']);
    // and each malformed entry carries a reason
    for (const entry of entries.slice(1)) expect(entry.errors.length).toBeGreaterThan(0);
  });

  it('returns an empty registry for an empty input list', () => {
    expect(registerModules([])).toEqual([]);
  });

  it('disables and re-enables only a valid module by id', () => {
    const registered = registerModules([validRaw()]);
    const disabled = setModuleEnabled(registered, 'demo', false);
    expect(disabled[0]!.state).toBe('disabled');

    const enabled = setModuleEnabled(disabled, 'demo', true);
    expect(enabled[0]!.state).toBe('enabled');
  });

  it('does not promote an invalid entry via setModuleEnabled', () => {
    const registered = registerModules([null]);
    const after = setModuleEnabled(registered, 'unknown', true);
    expect(after[0]!.state).toBe('invalid');
  });

  it('leaves entries untouched when the id does not match', () => {
    const registered = registerModules([validRaw()]);
    const after = setModuleEnabled(registered, 'ghost', false);
    expect(after[0]!.state).toBe('enabled');
  });

  it('projects tabs only from enabled modules with stable tabKeys', () => {
    const registered = registerModules([validRaw()]);
    expect(moduleTabs(registered)).toEqual([
      {
        tabKey: 'demo/welcome',
        entry: registered[0],
        tab: registered[0]!.manifest!.ui[0],
      },
    ]);

    const disabled = setModuleEnabled(registered, 'demo', false);
    expect(moduleTabs(disabled)).toEqual([]);

    // incompatible module contributes no tabs
    const incompatible = registerModules([validRaw({ apiVersion: 99 })]);
    expect(moduleTabs(incompatible)).toEqual([]);
  });
  it('blocks a module when a declared dependency is absent (fail closed)', () => {
    const entries = registerModules([validRaw({ id: 'consumer', dependencies: ['missing'] })]);
    expect(entries[0]!.state).toBe('blocked');
    expect(entries[0]!.errors.join(' ')).toMatch(/missing/i);
    expect(moduleTabs(entries)).toEqual([]);
  });

  it('resolves out-of-order valid dependencies without relying on manifest order', () => {
    const entries = registerModules([
      validRaw({ id: 'consumer', dependencies: ['provider'] }),
      validRaw({ id: 'provider' }),
    ]);
    expect(entries.map((e) => e.state)).toEqual(['enabled', 'enabled']);
    expect(moduleTabs(entries).map((t) => t.tabKey)).toEqual(['consumer/welcome', 'provider/welcome']);
  });

  it('blocks a dependent while its provider is disabled and restores it on re-enable', () => {
    const entries = registerModules([
      validRaw({ id: 'consumer', dependencies: ['provider'] }),
      validRaw({ id: 'provider' }),
      validRaw({ id: 'unrelated' }),
    ]);
    const disabled = setModuleEnabled(entries, 'provider', false);
    expect(disabled.map((e) => e.state)).toEqual(['blocked', 'disabled', 'enabled']);
    expect(disabled[0]!.errors.join(' ')).toMatch(/provider/i);
    expect(moduleTabs(disabled).map((t) => t.tabKey)).toEqual(['unrelated/welcome']);

    const restored = setModuleEnabled(disabled, 'provider', true);
    expect(restored.map((e) => e.state)).toEqual(['enabled', 'enabled', 'enabled']);
    expect(restored[0]!.errors).toEqual([]);
  });

  it('fails closed for cycles and self-dependencies without throwing', () => {
    const entries = registerModules([
      validRaw({ id: 'alpha', dependencies: ['beta'] }),
      validRaw({ id: 'beta', dependencies: ['alpha'] }),
      validRaw({ id: 'self', dependencies: ['self'] }),
    ]);
    expect(entries.map((e) => e.state)).toEqual(['blocked', 'blocked', 'blocked']);
    for (const entry of entries) expect(entry.errors.join(' ')).toMatch(/cycl/i);
    expect(moduleTabs(entries)).toEqual([]);
  });

  it('blocks a dependent of an incompatible module but preserves unrelated tabs', () => {
    const entries = registerModules([
      validRaw({ id: 'consumer', dependencies: ['future'] }),
      validRaw({ id: 'future', apiVersion: 99 }),
      validRaw({ id: 'independent' }),
    ]);
    expect(entries.map((e) => e.state)).toEqual(['blocked', 'incompatible', 'enabled']);
    expect(moduleTabs(entries).map((t) => t.tabKey)).toEqual(['independent/welcome']);
  });

  it('lets the owner explicitly disable a blocked module without automatically re-enabling it', () => {
    const registered = registerModules([
      validRaw({ id: 'consumer', dependencies: ['provider'] }),
      validRaw({ id: 'provider' }),
    ]);
    const blocked = setModuleEnabled(registered, 'provider', false);
    expect(blocked[0]!.state).toBe('blocked');

    const optedOut = setModuleEnabled(blocked, 'consumer', false);
    expect(optedOut[0]!.state).toBe('disabled');
    expect(optedOut[0]!.errors).toEqual([]);

    const restoredProvider = setModuleEnabled(optedOut, 'provider', true);
    expect(restoredProvider[0]!.state).toBe('disabled');
    expect(moduleTabs(restoredProvider).map((t) => t.tabKey)).toEqual(['provider/welcome']);

    const optedIn = setModuleEnabled(restoredProvider, 'consumer', true);
    expect(optedIn[0]!.state).toBe('enabled');
  });

  it('resolves a 4000-module dependency chain without stack overflow', () => {
    const raws = Array.from({ length: 4000 }, (_, index) =>
      validRaw({
        id: `m${index}`,
        dependencies: index < 3999 ? [`m${index + 1}`] : [],
      }),
    );
    const entries = registerModules(raws);
    expect(entries).toHaveLength(4000);
    expect(entries.every((entry) => entry.state === 'enabled')).toBe(true);
    expect(moduleTabs(entries)).toHaveLength(4000);
  });

  it('fails closed on a very deep cycle without crashing the registry or sibling tabs', () => {
    const count = 2000;
    const raws = Array.from({ length: count }, (_, index) =>
      validRaw({
        id: `cycle-${index}`,
        dependencies: [`cycle-${(index + 1) % count}`],
      }),
    );
    raws.push(validRaw({ id: 'safe' }));
    const entries = registerModules(raws);
    expect(entries).toHaveLength(count + 1);
    expect(entries.slice(0, count).every((entry) => entry.state === 'blocked')).toBe(true);
    expect(entries[0]!.errors.join(' ')).toMatch(/cycle/i);
    expect(moduleTabs(entries).map((tab) => tab.tabKey)).toEqual(['safe/welcome']);
  });

});

/* ------------------------------------------------------------------ */
/* M3 R03 — capability grants, panel projection, versioned deps        */
/* ------------------------------------------------------------------ */
import * as m3 from '../../src/shared/m3Protocol';
import {
  HOST_CAPABILITIES,
  modulePanels,
  resolveCapabilities,
} from '../../src/renderer/modules/registry';

function moduleRaw(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    version: '1.0.0',
    apiVersion: MODULE_API_VERSION,
    capabilities: ['runtime'],
    ui: [{ kind: 'tab', id: 'welcome', title: id, blocks: [{ type: 'text', value: id }] }],
    ...overrides,
  };
}

describe('M3 R03 registry — capability grants, panels, versioned deps', () => {
  it('grants only capabilities the host actually offers (declaration ≠ permission)', () => {
    expect(resolveCapabilities(['runtime', 'sessions'], ['runtime', 'sessions'])).toEqual({
      granted: ['runtime', 'sessions'],
      missing: [],
    });
    expect(resolveCapabilities(['runtime', 'notifications'], ['runtime'])).toEqual({
      granted: ['runtime'],
      missing: ['notifications'],
    });
    expect(HOST_CAPABILITIES).toEqual(['sessions', 'runtime', 'resources']);
  });

  it('fails a module closed when it declares a capability the host does not offer', () => {
    const entries = registerModules([moduleRaw('greedy', { capabilities: ['notifications'] })], {
      availableCapabilities: ['sessions', 'runtime', 'resources'],
    });
    const entry = entries[0]!;
    expect(entry.state).toBe('incompatible');
    expect(entry.errors.join(' ')).toMatch(/capability/i);
    expect(entry.errors.join(' ')).toMatch(/notifications/i);
    expect(moduleTabs(entries)).toEqual([]);
    expect(modulePanels(entries)).toEqual([]);
  });

  it('keeps a module enabled when every declared capability is offered', () => {
    const entries = registerModules([moduleRaw('ok', { capabilities: ['runtime', 'sessions'] })]);
    expect(entries[0]!.state).toBe('enabled');
    expect(moduleTabs(entries)).toHaveLength(1);
  });

  it('projects panels separately from tabs for enabled modules only', () => {
    const entries = registerModules([
      {
        ...moduleRaw('sidekick'),
        ui: [
          { kind: 'tab', id: 'main', title: 'Main', blocks: [{ type: 'text', value: 't' }] },
          { kind: 'panel', id: 'rail', title: 'Rail', blocks: [{ type: 'text', value: 'p' }] },
        ],
      },
      {
        ...moduleRaw('hidden'),
        ui: [{ kind: 'panel', id: 'off', title: 'Off', blocks: [{ type: 'text', value: 'p' }] }],
      },
    ]);

    const panels = modulePanels(entries);
    expect(panels.map((p) => p.tabKey)).toEqual(['sidekick/rail', 'hidden/off']);
    expect(moduleTabs(entries).map((t) => t.tabKey)).toEqual(['sidekick/main']);
    // panels and tabs must never collide on the projection key
    expect(modulePanels(entries).map((p) => p.tabKey)).not.toEqual(
      expect.arrayContaining(moduleTabs(entries).map((t) => t.tabKey)),
    );

    const disabled = setModuleEnabled(entries, 'sidekick', false);
    // the disabled module loses its panel; the unrelated enabled one keeps its own
    expect(modulePanels(disabled).map((p) => p.tabKey)).toEqual(['hidden/off']);
    expect(modulePanels(disabled).map((p) => p.tabKey)).not.toContain('sidekick/rail');
  });

  it('blocks a dependent whose dependency range is not satisfied by the provider', () => {
    const entries = registerModules([
      moduleRaw('provider', { version: '0.9.0' }),
      moduleRaw('consumer', { dependencies: [{ id: 'provider', range: '^1.0.0' }] }),
    ]);
    const consumer = entries.find((e) => e.id === 'consumer')!;
    expect(consumer.state).toBe('blocked');
    expect(consumer.errors.join(' ')).toMatch(/\^1\.0\.0/);
    expect(consumer.errors.join(' ')).toMatch(/0\.9\.0/);
  });

  it('does not block a dependent when the provider satisfies the range', () => {
    const entries = registerModules([
      moduleRaw('provider', { version: '1.4.0' }),
      moduleRaw('consumer', { dependencies: [{ id: 'provider', range: '^1.0.0' }] }),
    ]);
    expect(entries.find((e) => e.id === 'consumer')!.state).toBe('enabled');
  });

  it('exposes declared actions through the entry manifest', () => {
    const entries = registerModules([
      moduleRaw('actor', {
        actions: [{ id: 'reload', title: 'Обновить', operation: 'refresh' }],
      }),
    ]);
    expect(entries[0]!.manifest?.actions).toHaveLength(1);
    expect(entries[0]!.manifest?.actions[0]).toMatchObject({ id: 'reload', operation: 'refresh' });
    expect(typeof (m3 as Record<string, unknown>).MODULE_OPERATIONS).toBe('object');
  });
});
