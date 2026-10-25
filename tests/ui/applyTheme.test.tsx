import { describe, expect, it } from 'vitest';
import { applyTheme, cssVarName } from '../../src/renderer/design/applyTheme';
import { THEME_PRESETS } from '../../src/shared/design/presets';
import { applyTypography, typographyCssVarNames } from '../../src/renderer/design/applyTypography';
import { defaultTypography, type TypographyArea } from '../../src/shared/appearance';

describe('applyTheme (tokens → CSS custom properties, §9.1 item 1)', () => {
  it('maps every color token to a --pw-* custom property', () => {
    const el = document.createElement('div');
    applyTheme(el, THEME_PRESETS.dark.tokens);
    for (const [key, value] of Object.entries(THEME_PRESETS.dark.tokens)) {
      const name = cssVarName(key);
      expect(name.startsWith('--pw-'), key).toBe(true);
      expect(el.style.getPropertyValue(name).trim(), key).toBe(String(value));
    }
  });

  it('re-theming overwrites in place without accumulating stale values', () => {
    const el = document.createElement('div');
    applyTheme(el, THEME_PRESETS.dark.tokens);
    applyTheme(el, THEME_PRESETS.light.tokens);
    expect(el.style.getPropertyValue('--pw-window-background-color').trim()).toBe('#FAF9F6');
    expect(el.style.getPropertyValue('--pw-sidebar-left-background-color').trim()).toBe('#F0EFEB');
    // same variable set, no leftovers keyed to the previous theme
    const pwVars = [...el.style].filter((name) => name.startsWith('--pw-'));
    expect(pwVars.length).toBe(Object.keys(THEME_PRESETS.light.tokens).length);
    expect(pwVars.length).toBe(new Set(pwVars).size);
  });

  it('sets color-scheme metadata so native widgets match the theme', () => {
    const dark = document.createElement('div');
    applyTheme(dark, THEME_PRESETS.dark.tokens);
    expect(dark.style.getPropertyValue('color-scheme')).toBe('dark');
    const light = document.createElement('div');
    applyTheme(light, THEME_PRESETS.light.tokens);
    expect(light.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('keeps typography independent of the theme switch (§9.3)', () => {
    const el = document.createElement('div');
    const typo = defaultTypography();
    applyTypography(el, typo);
    applyTheme(el, THEME_PRESETS.claude.tokens);
    expect(el.style.getPropertyValue('--pw-font-code-family')).toContain('Cascadia Mono');
    applyTheme(el, THEME_PRESETS.codex.tokens);
    expect(el.style.getPropertyValue('--pw-font-code-family')).toContain('Cascadia Mono');
    expect(el.style.getPropertyValue('--pw-font-ui-size')).toContain('px');
  });
});

describe('applyTypography', () => {
  it('exposes font variables for every area (§9.3 list)', () => {
    const el = document.createElement('div');
    const typo = defaultTypography();
    applyTypography(el, typo);
    for (const [area] of Object.entries(typo) as [TypographyArea, { fontFamily: string; fontSizePx: number; lineHeight: number; weight: number }][]) {
      for (const [field, name] of Object.entries(typographyCssVarNames(area))) {
        const value = el.style.getPropertyValue(name).trim();
        expect(value.length, `${area}.${field}`).toBeGreaterThan(0);
      }
    }
    expect(el.style.getPropertyValue('--pw-font-terminal-family')).toContain('Cascadia Mono');
    // D3 (owner #6398531407): дефолты = канон typography.css (canonical scale)
    expect(el.style.getPropertyValue('--pw-font-chat-response-size')).toBe('20px');
    expect(el.style.getPropertyValue('--pw-font-ui-weight')).toBe('500');
  });

  it('D3: writes Design Lab --dl-fs-*/--dl-font-* from the same source (single typography source)', () => {
    const el = document.createElement('div');
    const typo = defaultTypography();
    applyTypography(el, typo);
    expect(el.style.getPropertyValue('--dl-fs-ui')).toBe('18px');
    expect(el.style.getPropertyValue('--dl-fs-sidebar')).toBe('17px');
    expect(el.style.getPropertyValue('--dl-fs-chat-response')).toBe('20px');
    expect(el.style.getPropertyValue('--dl-fs-terminal')).toBe('17px');
    expect(el.style.getPropertyValue('--dl-fs-status')).toBe('16px');
    expect(el.style.getPropertyValue('--dl-font-stack')).toContain('Segoe UI');
    expect(el.style.getPropertyValue('--dl-font-mono')).toContain('Cascadia Mono');
    // пользовательский кегль продолжает управлять lab-переменной
    const custom = defaultTypography();
    custom.ui.fontSizePx = 14;
    applyTypography(el, custom);
    expect(el.style.getPropertyValue('--dl-fs-ui')).toBe('14px');
  });
});
