/**
 * Owner Acceptance Repair R01 (#26, #6559283775): «белые контуры».
 *
 * Границы и разделители выводились из цвета ТЕКСТА, поэтому тёмная тема
 * получала почти белые обводки (#C6C9C3 / #D2D5CF). Контракт: границы
 * считаются от поверхности/панели и остаются спокойными во всех 9 палитрах,
 * при этом текст/подписи/фокус сохраняют AA.
 */
import { describe, expect, it } from 'vitest';
import { deriveTheme, luminance, mix } from '../../src/shared/design/deriveTheme';
import { DARK_PALETTES, LIGHT_PALETTES } from '../../src/shared/design/palettes';
import { THEME_PRESETS } from '../../src/shared/design/presets';
import { contrastRatio } from '../../src/shared/design/contrast';

const BASE = THEME_PRESETS.dark.tokens;
const ALL = [...LIGHT_PALETTES, ...DARK_PALETTES];

describe('границы выводятся от поверхности, а не от текста', () => {
  it('тёмная тема: граница близка к поверхности, а не к тексту', () => {
    const seed = { window: '#20221F', panel: '#191C19', accent: '#78957C', text: '#E7EAE3' };
    const t = deriveTheme(BASE, seed);
    // утверждённые ориентиры владельца: border ≈ #3A3D39, divider ≈ #2E312D
    expect(contrastRatio(t.borderColor, t.surfaceBackgroundColor)).toBeLessThan(2.2);
    expect(contrastRatio(t.borderColor, seed.text)).toBeGreaterThan(6);
    expect(luminance(t.dividerColor)).toBeLessThan(luminance(t.borderColor));
    expect(luminance(t.dividerColor)).toBeGreaterThan(luminance(seed.panel));
  });

  it('светлая тема: границы темнее поверхности, но заметно светлее текста', () => {
    const seed = { window: '#FAF9F6', panel: '#F0EFEB', accent: '#65816D', text: '#2B2E29' };
    const t = deriveTheme(BASE, seed);
    expect(luminance(t.surfaceBackgroundColor)).toBeGreaterThan(luminance(seed.window));
    expect(luminance(t.borderColor)).toBeLessThan(luminance(t.surfaceBackgroundColor));
    expect(contrastRatio(t.borderColor, seed.text)).toBeGreaterThan(7);
    expect(contrastRatio(t.dividerColor, t.surfaceBackgroundColor)).toBeLessThan(1.3);
  });

  it('все 9 палитр: спокойные границы, AA для текста и фокуса', () => {
    for (const palette of ALL) {
      const t = deriveTheme(BASE, palette.seed);
      const id = palette.id;
      for (const [name, value] of [
        ['border', t.borderColor],
        ['divider', t.dividerColor],
        ['inputBorder', t.inputBorderColor],
        ['toolCardBorder', t.toolCardBorderColor],
      ] as const) {
        const vsSurface = contrastRatio(value, t.surfaceBackgroundColor);
        expect(vsSurface, `${id}.${name} vs surface`).toBeLessThan(2.6);
        const vsText = contrastRatio(value, t.bodyTextColor);
        expect(vsText, `${id}.${name} vs text`).toBeGreaterThan(3);
      }
      expect(contrastRatio(t.bodyTextColor, t.surfaceBackgroundColor), `${id} body`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.mutedTextColor, t.surfaceBackgroundColor), `${id} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.mutedTextColor, palette.seed.window), `${id} muted/window`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.linkColor, t.surfaceBackgroundColor), `${id} link`).toBeGreaterThanOrEqual(4.5);
      expect(t.focusRingColor).toBe(palette.seed.accent);
    }
  });

  it('hover/selected — тонировка поверхности, а не заливка акцентом', () => {
    for (const palette of ALL) {
      const t = deriveTheme(BASE, palette.seed);
      expect(contrastRatio(t.hoverBackgroundColor, t.surfaceBackgroundColor)).toBeLessThan(1.6);
      expect(contrastRatio(t.selectedBackgroundColor, t.surfaceBackgroundColor)).toBeLessThan(1.9);
      expect(t.hoverBackgroundColor).not.toBe(palette.seed.accent);
    }
  });

  it('титульная панель использует цвет боковых панелей (как в Design Lab)', () => {
    for (const palette of ALL) {
      const t = deriveTheme(BASE, palette.seed);
      expect(t.titleBarBackgroundColor).toBe(palette.seed.panel);
      expect(t.statusBarBackgroundColor).toBe(palette.seed.panel);
      expect(t.sidebarLeftBackgroundColor).toBe(palette.seed.panel);
      expect(t.sidebarRightBackgroundColor).toBe(palette.seed.panel);
    }
  });

  it('mix не мутирует входные данные и остаётся детерминированным', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe(mix('#000000', '#FFFFFF', 0.5));
  });
});
