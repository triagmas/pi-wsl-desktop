/**
 * Per-area typography (§9.3): every area gets independent family/size/line
 * height/weight as CSS variables. Typography settings are applied separately
 * from the theme, so a theme switch never resets chosen fonts.
 */
import type { AppearanceSettings, TypographyArea, TypographyZone } from '../../shared/appearance';

export function typographyCssVarNames(area: TypographyArea): Record<keyof TypographyZone, string> {
  const kebab = area.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return {
    fontFamily: `--pw-font-${kebab}-family`,
    fontSizePx: `--pw-font-${kebab}-size`,
    lineHeight: `--pw-font-${kebab}-line-height`,
    weight: `--pw-font-${kebab}-weight`,
  };
}

export function applyTypography(
  root: HTMLElement,
  typography: AppearanceSettings['typography'],
): void {
  for (const [area, zone] of Object.entries(typography) as [TypographyArea, TypographyZone][]) {
    const names = typographyCssVarNames(area);
    root.style.setProperty(names.fontFamily, zone.fontFamily);
    root.style.setProperty(names.fontSizePx, `${zone.fontSizePx}px`);
    root.style.setProperty(names.lineHeight, String(zone.lineHeight));
    root.style.setProperty(names.weight, String(zone.weight));
  }
}
