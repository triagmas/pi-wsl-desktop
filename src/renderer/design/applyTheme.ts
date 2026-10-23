/**
 * Applies theme tokens to a root element as CSS custom properties.
 * Themes swap TOKENS only — components never branch per theme (§9.1 item 1).
 */
import type { ThemeTokens } from '../../shared/design/presets';

export function cssVarName(tokenKey: string): string {
  const kebab = tokenKey
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return `--pw-${kebab}`;
}

function brightnessOf(hex: string): 'dark' | 'light' {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Rec. 709 luma approximation is enough to pick native color-scheme.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? 'light' : 'dark';
}

export function applyTheme(root: HTMLElement, tokens: ThemeTokens): void {
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(cssVarName(key), String(value));
  }
  root.style.setProperty('color-scheme', brightnessOf(tokens.windowBackgroundColor));
}
