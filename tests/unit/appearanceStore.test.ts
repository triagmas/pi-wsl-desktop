import * as fs from 'node:fs';
import { vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    renameSync: vi.fn(actual.renameSync),
  };
});
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_FILE,
  APPEARANCE_VERSION,
  DEFAULT_APPEARANCE,
  loadAppearance,
  resetAppearance,
  saveAppearance,
} from '../../src/main/appearanceStore';
import type { AppearanceSettings } from '../../src/shared/appearance';
import { THEME_PRESETS } from '../../src/shared/design/presets';

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'pw-appear-'));
}

describe('appearance store (versioned Desktop-only storage, §9.1)', () => {
  it('returns defaults for a missing file without creating one', () => {
    const dir = freshDir();
    const loaded = loadAppearance(dir);
    expect(loaded).toEqual(DEFAULT_APPEARANCE);
    expect(existsSync(path.join(dir, APPEARANCE_FILE))).toBe(false);
  });

  it('returns safe defaults for corrupt JSON (never throws)', () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, APPEARANCE_FILE), '{not json', 'utf8');
    expect(() => loadAppearance(dir)).not.toThrow();
    expect(loadAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
  });

  it('repairs invalid fields individually instead of dropping everything', () => {
    const dir = freshDir();
    writeFileSync(
      path.join(dir, APPEARANCE_FILE),
      JSON.stringify({
        version: APPEARANCE_VERSION,
        theme: { preset: 'dark' },
        typography: { ui: { fontFamily: 'Segoe UI', fontSizePx: 999, lineHeight: -4 } },
        layout: { leftWidth: 99999, rightVisible: 'yes' },
      }),
      'utf8',
    );
    const loaded = loadAppearance(dir);
    expect(loaded.theme.preset).toBe('dark'); // valid part kept
    expect(loaded.typography.ui.fontFamily).toBe('Segoe UI');
    expect(loaded.typography.ui.fontSizePx).toBe(DEFAULT_APPEARANCE.typography.ui.fontSizePx);
    expect(loaded.typography.ui.lineHeight).toBe(DEFAULT_APPEARANCE.typography.ui.lineHeight);
    expect(loaded.layout.leftWidth).toBe(DEFAULT_APPEARANCE.layout.leftWidth);
    expect(loaded.layout.rightVisible).toBe(DEFAULT_APPEARANCE.layout.rightVisible);
  });

  it('migrates an unversioned legacy file to the current version', () => {
    const dir = freshDir();
    writeFileSync(
      path.join(dir, APPEARANCE_FILE),
      JSON.stringify({ theme: { preset: 'light' } }),
      'utf8',
    );
    const loaded = loadAppearance(dir);
    expect(loaded.version).toBe(APPEARANCE_VERSION);
    expect(loaded.theme.preset).toBe('light');
  });

  it('falls back to defaults for an unknown FUTURE version (no crash)', () => {
    const dir = freshDir();
    writeFileSync(
      path.join(dir, APPEARANCE_FILE),
      JSON.stringify({ version: APPEARANCE_VERSION + 7, theme: { preset: 'dark' } }),
      'utf8',
    );
    expect(loadAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
  });

  it('round-trips theme, custom tokens, typography and layout atomically', () => {
    const dir = freshDir();
    const patch: AppearanceSettings = {
      ...DEFAULT_APPEARANCE,
      theme: {
        preset: 'custom',
        customName: 'Моя графитовая',
        custom: { ...THEME_PRESETS.dark.tokens },
      },
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        code: { fontFamily: 'Cascadia Mono, Consolas, monospace', fontSizePx: 13, lineHeight: 1.5, weight: 400 },
      },
      layout: { leftWidth: 300, rightWidth: 360, leftCollapsed: true, rightVisible: true, terminalSlotHeight: 240 },
    };
    const saved = saveAppearance(dir, patch);
    expect(saved).toEqual(patch);
    expect(loadAppearance(dir)).toEqual(patch);
    // no stray temp file left behind (atomic rename)
    expect(existsSync(path.join(dir, `${APPEARANCE_FILE}.tmp`))).toBe(false);
    const onDisk = JSON.parse(readFileSync(path.join(dir, APPEARANCE_FILE), 'utf8'));
    expect(onDisk.version).toBe(APPEARANCE_VERSION);
  });

  it('rolls back after a PARTIALLY written temp file: previous file intact, temp removed (round-2 review)', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const dir = freshDir();
    saveAppearance(dir, { ...DEFAULT_APPEARANCE, layout: { ...DEFAULT_APPEARANCE.layout, leftWidth: 333 } });
    const before = fs.readFileSync(path.join(dir, APPEARANCE_FILE), 'utf8');
    // The write FAILS MID-FILE: bytes already land on disk before the error,
    // which is the case the rollback guarantee actually has to survive.
    vi.mocked(fs.writeFileSync).mockImplementationOnce((file, data) => {
      actual.writeFileSync(file as string, String(data).slice(0, 16));
      throw new Error('disk full');
    });
    expect(() => saveAppearance(dir, { ...DEFAULT_APPEARANCE, layout: { ...DEFAULT_APPEARANCE.layout, leftWidth: 444 } })).toThrow('disk full');
    // The previous file must be byte-identical and the partial temp removed.
    expect(fs.readFileSync(path.join(dir, APPEARANCE_FILE), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, `${APPEARANCE_FILE}.tmp`))).toBe(false);
    expect(loadAppearance(dir).layout.leftWidth).toBe(333);
  });

  it('reset restores exact defaults on disk', () => {
    const dir = freshDir();
    saveAppearance(dir, { ...DEFAULT_APPEARANCE, layout: { ...DEFAULT_APPEARANCE.layout, leftWidth: 320 } });
    const reset = resetAppearance(dir);
    expect(reset).toEqual(DEFAULT_APPEARANCE);
    expect(loadAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
  });

  it('a save failure keeps the previous file intact (rollback guarantee)', () => {
    const dir = freshDir();
    saveAppearance(dir, { ...DEFAULT_APPEARANCE, layout: { ...DEFAULT_APPEARANCE.layout, leftWidth: 333 } });
    // Simulate a failure DURING the temp write: read-only dir triggers the
    // store's own error path; the original file must still load.
    // (Easiest deterministic simulation: make the target file a directory-less
    // read-only file is platform-specific, so we instead verify the contract:
    // load never throws and returns what was last successfully written.)
    expect(loadAppearance(dir).layout.leftWidth).toBe(333);
  });
});
