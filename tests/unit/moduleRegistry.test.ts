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
});
