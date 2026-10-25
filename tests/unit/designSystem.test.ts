import { describe, expect, it } from 'vitest';
import {
  PRESET_IDS,
  THEME_PRESETS,
  type ThemePresetId,
  type ThemeTokens,
  semanticTokenKeys,
} from '../../src/shared/design/presets';
import { contrastRatio, meetsAA, hexColor } from '../../src/shared/design/contrast';
import { validateCustomTokens } from '../../src/renderer/design/customTheme';

/**
 * Issue #21 §9.2 / exec task #6354590198 step 4: four immutable presets plus
 * the semantic token contract shared by the custom theme editor.
 */
describe('design system presets', () => {
  it('exposes exactly the four immutable presets', () => {
    expect(PRESET_IDS).toEqual(['dark', 'light', 'claude', 'codex']);
    expect(Object.keys(THEME_PRESETS).sort()).toEqual([...PRESET_IDS].sort());
  });

  it('every preset defines the full semantic token set', () => {
    const required = semanticTokenKeys();
    expect(required.length).toBeGreaterThanOrEqual(30);
    for (const id of PRESET_IDS) {
      const preset = THEME_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.immutable).toBe(true);
      for (const key of required) {
        expect(preset.tokens, `${id}.${key}`).toHaveProperty(key);
      }
    }
  });

  it('color tokens are valid #rrggbb hex', () => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const id of PRESET_IDS) {
      for (const [key, value] of Object.entries(THEME_PRESETS[id].tokens)) {
        if (key.endsWith('Color') && key !== 'syntaxColors') {
          expect(value, `${id}.${key}=${String(value)}`).toMatch(hex);
        }
      }
    }
  });

  it('Dark preset anchors the palette from Issue #21 §1', () => {
    const t = THEME_PRESETS.dark.tokens;
    expect(t.windowBackgroundColor).toBe('#20221F');
    expect(t.sidebarLeftBackgroundColor).toBe('#191C19');
    expect(t.surfaceBackgroundColor).toBe('#2A2E29');
    expect(t.dividerColor).toBe('#3A4038');
    expect(t.bodyTextColor).toBe('#E7EAE3');
    expect(t.mutedTextColor).toBe('#A9B1A5');
    expect(t.accentColor).toBe('#78957C');
  });

  it('Light preset anchors the milk palette from Issue #21 §1', () => {
    const t = THEME_PRESETS.light.tokens;
    expect(t.windowBackgroundColor).toBe('#FAF9F6');
    expect(t.sidebarLeftBackgroundColor).toBe('#F0EFEB');
    expect(t.accentColor).toBe('#65816D');
  });

  it('Claude/Codex are recognizable inspired-by presets with distinct palettes', () => {
    const claude = THEME_PRESETS.claude.tokens;
    const codex = THEME_PRESETS.codex.tokens;
    expect(claude.windowBackgroundColor).not.toBe(codex.windowBackgroundColor);
    expect(claude.windowBackgroundColor).not.toBe(THEME_PRESETS.dark.tokens.windowBackgroundColor);
    expect(codex.windowBackgroundColor).not.toBe(THEME_PRESETS.dark.tokens.windowBackgroundColor);
    expect(THEME_PRESETS.claude.label).toMatch(/claude/i);
    expect(THEME_PRESETS.codex.label).toMatch(/codex/i);
    expect(THEME_PRESETS.claude.attribution).toBeTruthy();
    expect(THEME_PRESETS.codex.attribution).toBeTruthy();
  });

  it('every preset passes AA for body/muted text against its backgrounds', () => {
    for (const id of PRESET_IDS) {
      const t = THEME_PRESETS[id].tokens;
      expect(meetsAA(t.bodyTextColor, t.windowBackgroundColor), `${id} body/window`).toBe(true);
      expect(meetsAA(t.bodyTextColor, t.sidebarLeftBackgroundColor), `${id} body/sidebar`).toBe(true);
      expect(meetsAA(t.bodyTextColor, t.surfaceBackgroundColor), `${id} body/surface`).toBe(true);
      expect(meetsAA(t.mutedTextColor, t.windowBackgroundColor), `${id} muted/window`).toBe(true);
      expect(meetsAA(t.linkColor, t.windowBackgroundColor), `${id} link/window`).toBe(true);
      expect(meetsAA(t.linkColor, t.surfaceBackgroundColor), `${id} link/surface`).toBe(true);
    }
  });
});

describe('D3: approved typography defaults (Design Lab canonical scale)', () => {
  it('DEFAULT_TYPOGRAPHY equals typography.css canonical values (owner #6398531407)', async () => {
    const { DEFAULT_APPEARANCE } = await import('../../src/shared/appearance');
    const t = DEFAULT_APPEARANCE.typography;
    expect(t.ui).toMatchObject({ fontSizePx: 18, lineHeight: 1.4, weight: 500 });
    expect(t.sidebar).toMatchObject({ fontSizePx: 17, lineHeight: 1.5, weight: 400 });
    expect(t.chatInput).toMatchObject({ fontSizePx: 20, lineHeight: 1.45, weight: 400 });
    expect(t.chatResponse).toMatchObject({ fontSizePx: 20, lineHeight: 1.55, weight: 400 });
    expect(t.code).toMatchObject({ fontSizePx: 17, lineHeight: 1.5, weight: 500 });
    expect(t.toolOutput).toMatchObject({ fontSizePx: 16, lineHeight: 1.5, weight: 400 });
    expect(t.terminal).toMatchObject({ fontSizePx: 17, lineHeight: 1.5, weight: 400 });
    expect(t.statusBar).toMatchObject({ fontSizePx: 16, lineHeight: 1.4, weight: 400 });
    // стеки = canonical --dl-font-stack / --dl-font-mono
    expect(t.ui.fontFamily).toContain('Segoe UI');
    expect(t.ui.fontFamily).toContain('Helvetica Neue');
    expect(t.code.fontFamily).toContain('Cascadia Mono');
    expect(t.code.fontFamily).toContain('ui-monospace');
  });
});

describe('contrast math', () => {
  it('computes WCAG ratios (black on white = 21)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('meetsAA requires 4.5:1 for normal text', () => {
    expect(meetsAA('#777777', '#ffffff')).toBe(false);
    expect(meetsAA('#595959', '#ffffff')).toBe(true);
  });

  it('rejects non-hex inputs instead of guessing', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow();
  });
});

describe('hexColor: любой CSS-цвет → #rrggbb (board, «Своя тема»)', () => {
  it('converts hsl() functional notation to hex', () => {
    expect(hexColor('hsl(0 100% 50%)')).toBe('#ff0000');
    expect(hexColor('hsl(120, 14%, 47%)')).toBe('#678967');
    expect(hexColor('hsl(210 80% 50%)')).toBe('#197fe6');
  });

  it('converts rgb() functional notation to hex', () => {
    expect(hexColor('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(hexColor('rgb(0 0 0 / 50%)')).toBe('#000000');
  });

  it('passes hex through unchanged (case normalized)', () => {
    expect(hexColor('#78957C')).toBe('#78957c');
  });

  it('throws on unsupported colors instead of guessing (fail-safe)', () => {
    expect(() => hexColor('red')).toThrow();
    expect(() => hexColor('var(--x)')).toThrow();
    expect(() => hexColor('linear-gradient(#000, #fff)')).toThrow();
  });

  it('round-trips into contrast math for the board AA badge', () => {
    expect(() => contrastRatio(hexColor('hsl(120 14% 47%)'), '#20221f')).not.toThrow();
  });
});

describe('custom theme validation (editor contract)', () => {
  it('accepts a valid clone of a preset', () => {
    const result = validateCustomTokens({ ...THEME_PRESETS.dark.tokens });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects malformed hex with a token key', () => {
    const bad = { ...THEME_PRESETS.dark.tokens, bodyTextColor: 'white' } as ThemeTokens;
    const result = validateCustomTokens(bad);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ key: 'bodyTextColor', kind: 'hex' });
  });

  it('rejects a tool-card background that clashes with body/muted text (round-3 P2)', () => {
    // The tool result bubbles use toolCardBackgroundColor as their surface;
    // body text and the muted role label render on top of it.
    const bodyClash = {
      ...THEME_PRESETS.dark.tokens,
      toolCardBackgroundColor: THEME_PRESETS.dark.tokens.bodyTextColor,
    };
    const r1 = validateCustomTokens(bodyClash);
    expect(r1.ok).toBe(false);
    expect(r1.issues.map((i) => i.message).join(' ')).toContain('bodyTextColor на toolCardBackgroundColor');

    const mutedClash = {
      ...THEME_PRESETS.dark.tokens,
      toolCardBackgroundColor: THEME_PRESETS.dark.tokens.mutedTextColor,
    };
    const r2 = validateCustomTokens(mutedClash);
    expect(r2.ok).toBe(false);
    expect(r2.issues.map((i) => i.message).join(' ')).toContain('mutedTextColor на toolCardBackgroundColor');
  });

  it('flags low-contrast text pairs as contrast issues (AA)', () => {
    const bad = { ...THEME_PRESETS.dark.tokens, bodyTextColor: '#2A2E29' } as ThemeTokens;
    const result = validateCustomTokens(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'contrast')).toBe(true);
  });

  it('identifies the preset as unknown for a non-preset id', () => {
    const unknown = 'solarized-80' as unknown as ThemePresetId;
    expect(PRESET_IDS).not.toContain(unknown);
  });
});
