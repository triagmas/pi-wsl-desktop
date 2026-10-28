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

/**
 * D3 (owner #6398531407): один источник типографики. Тот же вызов пишет и
 * канонические Design Lab-переменные (--dl-fs-*, --dl-font-*), которыми
 * стилизуются одобренные компоненты: дефолты = typography.css (canonical
 * scale), пользовательский кегль/шрифт из Settings применяется поверх — без
 * CSS-мостов и переопределений в app-скоупе.
 */
const DL_SIZE_VARS: Record<TypographyArea, string> = {
  ui: '--dl-fs-ui',
  sidebar: '--dl-fs-sidebar',
  chatInput: '--dl-fs-chat-input',
  chatResponse: '--dl-fs-chat-response',
  code: '--dl-fs-code',
  toolOutput: '--dl-fs-tool-output',
  terminal: '--dl-fs-terminal',
  statusBar: '--dl-fs-status',
};

const DL_FAMILY_VARS: Record<TypographyArea, string> = {
  ui: '--dl-font-stack',
  sidebar: '--dl-font-stack',
  chatInput: '--dl-font-stack',
  chatResponse: '--dl-font-stack',
  statusBar: '--dl-font-stack',
  code: '--dl-font-mono',
  toolOutput: '--dl-font-mono',
  terminal: '--dl-font-mono',
};

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
    root.style.setProperty(DL_SIZE_VARS[area], `${zone.fontSizePx}px`);
    root.style.setProperty(DL_FAMILY_VARS[area], zone.fontFamily);
  }
}
