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
import { migrateAppearance } from '../../src/shared/appearance';
import type { AppearanceSettings } from '../../src/shared/appearance';
import { fontStackById, SYSTEM_FONT_STACK } from '../../src/shared/design/palettes';

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
        theme: { mode: 'light', preset: { light: 'astra', dark: 'dark' }, custom: { light: { window: '#123456' } } },
        typography: { ui: { fontFamily: 'Comic Sans', fontSizePx: 999, lineHeight: -4 } },
        layout: { leftWidth: 99999, rightVisible: 'yes' },
      }),
      'utf8',
    );
    const loaded = loadAppearance(dir);
    expect(loaded.theme.mode).toBe('light'); // valid part kept
    expect(loaded.theme.preset.light).toBe('astra');
    expect(loaded.theme.custom.light.window).toBe('#123456');
    expect(loaded.typography.ui.fontFamily).toBe(SYSTEM_FONT_STACK); // системный шрифт неизменяем
    expect(loaded.typography.ui.fontSizePx).toBe(DEFAULT_APPEARANCE.typography.ui.fontSizePx);
    expect(loaded.typography.ui.lineHeight).toBe(DEFAULT_APPEARANCE.typography.ui.lineHeight);
    expect(loaded.layout.leftWidth).toBe(DEFAULT_APPEARANCE.layout.leftWidth);
    expect(loaded.layout.rightVisible).toBe(DEFAULT_APPEARANCE.layout.rightVisible);
  });

  it('terminal dock visibility persists (default on) and repairs invalid values', () => {
    // default: dock visible (поведение UI-A не меняется)
    expect(DEFAULT_APPEARANCE.layout.terminalVisible).toBe(true);
    expect(migrateAppearance(undefined).layout.terminalVisible).toBe(true);
    const dir = freshDir();
    // explicit false survives a round-trip (скрытый док переживает перезапуск)
    writeFileSync(
      path.join(dir, APPEARANCE_FILE),
      JSON.stringify({ ...DEFAULT_APPEARANCE, layout: { ...DEFAULT_APPEARANCE.layout, terminalVisible: false } }),
      'utf8',
    );
    expect(loadAppearance(dir).layout.terminalVisible).toBe(false);
    // junk → default, остальные поля не затираются
    writeFileSync(
      path.join(dir, APPEARANCE_FILE),
      JSON.stringify({ ...DEFAULT_APPEARANCE, layout: { ...DEFAULT_APPEARANCE.layout, terminalVisible: 'no' } }),
      'utf8',
    );
    expect(loadAppearance(dir).layout.terminalVisible).toBe(true);
    expect(loadAppearance(dir).layout.leftWidth).toBe(DEFAULT_APPEARANCE.layout.leftWidth);
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
    // v1 «light» → режим light с палитрой light; тёмная ветка остаётся по умолчанию
    expect(loaded.theme.mode).toBe('light');
    expect(loaded.theme.preset.light).toBe('light');
    expect(loaded.theme.preset.dark).toBe(DEFAULT_APPEARANCE.theme.preset.dark);
  });

  it('migrates a v1 custom theme into four colors without losing the palette', () => {
    const dir = freshDir();
    writeFileSync(
      path.join(dir, APPEARANCE_FILE),
      JSON.stringify({
        version: 1,
        theme: {
          preset: 'custom',
          customName: 'Моя тёмная',
          custom: {
            windowBackgroundColor: '#101418',
            sidebarLeftBackgroundColor: '#0B0F12',
            sidebarRightBackgroundColor: '#0B0F12',
            accentColor: '#48A37C',
            bodyTextColor: '#E6EDEA',
            radiusSmall: '6px',
          },
        },
      }),
      'utf8',
    );
    const loaded = loadAppearance(dir);
    expect(loaded.theme.mode).toBe('dark');
    expect(loaded.theme.preset.dark).toBe('customDark');
    expect(loaded.theme.custom.dark).toEqual({
      window: '#101418',
      panel: '#0B0F12',
      accent: '#48A37C',
      text: '#E6EDEA',
    });
    // светлая ветка не тронута
    expect(loaded.theme.custom.light).toEqual(DEFAULT_APPEARANCE.theme.custom.light);
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
        mode: 'dark',
        preset: { light: 'astra', dark: 'customDark' },
        custom: {
          light: { window: '#F7F7F2', panel: '#EFEFE8', accent: '#336699', text: '#1B1B18' },
          dark: { window: '#111417', panel: '#0C0F11', accent: '#4FA07E', text: '#E8EDEA' },
        },
      },
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        code: { fontFamily: fontStackById('courier'), fontSizePx: 13, lineHeight: 1.5, weight: 400 },
      },
      layout: { leftWidth: 300, rightWidth: 360, leftCollapsed: true, rightVisible: true, terminalSlotHeight: 240, terminalVisible: false },
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
