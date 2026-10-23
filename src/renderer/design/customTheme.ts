/**
 * Custom theme editor validation (Issue #21 §9.2): semantic color tokens must
 * be well-formed hex and text pairs must stay AA-readable; the editor reports
 * problems instead of applying a broken theme (fail-safe, never crashes).
 */
import { COLOR_TOKEN_KEYS, THEME_PRESETS, type ThemeTokens } from '../../shared/design/presets';
import { contrastRatio } from '../../shared/design/contrast';

export type ValidationKind = 'hex' | 'contrast';

export interface ValidationIssue {
  key: keyof ThemeTokens;
  kind: ValidationKind;
  message: string;
  ratio?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Text/background pairs that must stay AA-readable (4.5:1). */
function textPairs(): [keyof ThemeTokens, keyof ThemeTokens][] {
  return [
    ['bodyTextColor', 'windowBackgroundColor'],
    ['bodyTextColor', 'sidebarLeftBackgroundColor'],
    ['bodyTextColor', 'sidebarRightBackgroundColor'],
    ['bodyTextColor', 'surfaceBackgroundColor'],
    ['bodyTextColor', 'elevatedSurfaceBackgroundColor'],
    ['bodyTextColor', 'chatBubbleUserBackgroundColor'],
    ['bodyTextColor', 'chatBubbleAssistantBackgroundColor'],
    ['mutedTextColor', 'windowBackgroundColor'],
    ['mutedTextColor', 'surfaceBackgroundColor'],
    ['linkColor', 'windowBackgroundColor'],
    ['linkColor', 'surfaceBackgroundColor'],
    ['buttonPrimaryTextColor', 'buttonPrimaryBackgroundColor'],
    ['placeholderColor', 'inputBackgroundColor'],
    ['accentTextColor', 'accentColor'],
    ['selectionTextColor', 'selectionBackgroundColor'],
    ['codeForegroundColor', 'codeBackgroundColor'],
    ['terminalForegroundColor', 'terminalBackgroundColor'],
  ];
}

export function validateCustomTokens(tokens: ThemeTokens): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const key of COLOR_TOKEN_KEYS) {
    const value = tokens[key];
    if (typeof value !== 'string' || !HEX.test(value)) {
      issues.push({
        key,
        kind: 'hex',
        message: `Ожидался цвет в формате #rrggbb, получено: ${JSON.stringify(value)}`,
      });
    }
  }
  // Contrast checks only make sense for well-formed colors.
  if (issues.length === 0) {
    for (const [fgKey, bgKey] of textPairs()) {
      // Both values are validated hex above.
      const ratio = Number(contrastRatio(tokens[fgKey] as string, tokens[bgKey] as string).toFixed(2));
      if (ratio < 4.5) {
        issues.push({
          key: fgKey,
          kind: 'contrast',
          ratio,
          message: `Контраст ${fgKey} на ${bgKey} ниже AA (4.5:1): ${ratio}:1`,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Suggests the nearest preset pair color that restores AA for a failing pair. */
export function suggestFix(
  issue: ValidationIssue,
  basePreset: keyof typeof THEME_PRESETS = 'dark',
): string | null {
  if (issue.kind !== 'contrast') return null;
  const preset = THEME_PRESETS[basePreset].tokens;
  const value = preset[issue.key];
  return typeof value === 'string' && HEX.test(value) ? value : null;
}
