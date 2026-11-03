import { CUSTOM_PALETTE_ID, DARK_PALETTES, LIGHT_PALETTES, PALETTES_BY_MODE, type ThemePalette } from './palettes';
import { deriveTheme, type PaletteSeed } from './deriveTheme';

/**
 * Semantic design tokens and immutable theme presets (Issue #21 §9.1/§9.2).
 *
 * Themes change TOKENS ONLY — components consume CSS custom properties
 * (`var(--pw-…)`) written by applyTheme, never per-theme JSX branches.
 * Dark/Light palettes come from Issue §1; Claude/Codex are clearly labeled
 * inspired-by presets, not asserted official palettes.
 */

export interface ThemeTokens {
  windowBackgroundColor: string;
  titleBarBackgroundColor: string;
  sidebarLeftBackgroundColor: string;
  sidebarRightBackgroundColor: string;
  statusBarBackgroundColor: string;
  surfaceBackgroundColor: string;
  elevatedSurfaceBackgroundColor: string;

  chatInputBackgroundColor: string;
  chatBubbleUserBackgroundColor: string;
  chatBubbleAssistantBackgroundColor: string;

  bodyTextColor: string;
  mutedTextColor: string;
  linkColor: string;

  accentColor: string;
  accentHoverColor: string;
  accentActiveColor: string;
  accentTextColor: string;

  buttonPrimaryBackgroundColor: string;
  buttonPrimaryHoverColor: string;
  buttonPrimaryActiveColor: string;
  buttonPrimaryDisabledColor: string;
  buttonPrimaryTextColor: string;

  inputBackgroundColor: string;
  inputBorderColor: string;
  placeholderColor: string;
  focusRingColor: string;
  selectionBackgroundColor: string;
  selectionTextColor: string;

  borderColor: string;
  dividerColor: string;
  hoverBackgroundColor: string;
  selectedBackgroundColor: string;

  warningColor: string;
  errorColor: string;
  successColor: string;

  toolCardBackgroundColor: string;
  toolCardBorderColor: string;

  codeBackgroundColor: string;
  codeForegroundColor: string;
  syntaxKeywordColor: string;
  syntaxStringColor: string;
  syntaxCommentColor: string;
  syntaxNumberColor: string;
  syntaxFunctionColor: string;

  terminalBackgroundColor: string;
  terminalForegroundColor: string;
  terminalCursorColor: string;
  terminalAnsiBlackColor: string;
  terminalAnsiRedColor: string;
  terminalAnsiGreenColor: string;
  terminalAnsiYellowColor: string;
  terminalAnsiBlueColor: string;
  terminalAnsiMagentaColor: string;
  terminalAnsiCyanColor: string;
  terminalAnsiWhiteColor: string;
  terminalAnsiBrightBlackColor: string;
  terminalAnsiBrightRedColor: string;
  terminalAnsiBrightGreenColor: string;
  terminalAnsiBrightYellowColor: string;
  terminalAnsiBrightBlueColor: string;
  terminalAnsiBrightMagentaColor: string;
  terminalAnsiBrightCyanColor: string;
  terminalAnsiBrightWhiteColor: string;

  radiusSmall: string;
  radiusMedium: string;
  radiusLarge: string;
  spacingScale: number;
  animationDurationMs: number;
}

/**
 * Девять палитр контракта: 5 светлых и 4 тёмных, включая «свою» в каждом режиме.
 * Палитра задаётся четырьмя цветами (см. palettes.ts), полный набор токенов
 * выводит deriveTheme — поэтому тема меняет весь интерфейс, а не только образцы.
 */
export type ThemeMode = 'light' | 'dark';

export type BuiltinPresetId =
  | 'light'
  | 'astra'
  | 'claudeLight'
  | 'codexLight'
  | 'dark'
  | 'claudeDark'
  | 'codexDark';

/** Идентификатор выбранной палитры режима: встроенная или «своя». */
export type ThemePresetId = BuiltinPresetId | 'customLight' | 'customDark';

export const PRESET_IDS: readonly BuiltinPresetId[] = [
  'light',
  'astra',
  'claudeLight',
  'codexLight',
  'dark',
  'claudeDark',
  'codexDark',
] as const;

export interface ThemePreset {
  id: BuiltinPresetId;
  label: string;
  /** 'inspired-by' presets carry an attribution disclaimer (§9.2). */
  attribution?: string;
  immutable: true;
  tokens: ThemeTokens;
}

const DARK: ThemeTokens = {
  windowBackgroundColor: '#20221F',
  titleBarBackgroundColor: '#191C19',
  sidebarLeftBackgroundColor: '#191C19',
  sidebarRightBackgroundColor: '#191C19',
  statusBarBackgroundColor: '#191C19',
  surfaceBackgroundColor: '#2A2E29',
  elevatedSurfaceBackgroundColor: '#333831',

  chatInputBackgroundColor: '#2A2E29',
  chatBubbleUserBackgroundColor: '#333831',
  chatBubbleAssistantBackgroundColor: '#20221F',

  bodyTextColor: '#E7EAE3',
  mutedTextColor: '#A9B1A5',
  linkColor: '#A3C1A9',

  accentColor: '#78957C',
  accentHoverColor: '#89A58D',
  accentActiveColor: '#6A8770',
  accentTextColor: '#20221F',

  buttonPrimaryBackgroundColor: '#78957C',
  buttonPrimaryHoverColor: '#89A58D',
  buttonPrimaryActiveColor: '#6A8770',
  buttonPrimaryDisabledColor: '#3A4038',
  buttonPrimaryTextColor: '#171A16',

  inputBackgroundColor: '#2A2E29',
  inputBorderColor: '#3A4038',
  placeholderColor: '#939B8E',
  focusRingColor: '#9DBFA5',
  selectionBackgroundColor: '#3B4A40',
  selectionTextColor: '#E7EAE3',

  borderColor: '#3A4038',
  dividerColor: '#3A4038',
  hoverBackgroundColor: '#2F342E',
  selectedBackgroundColor: '#2B312C',

  warningColor: '#C7A15A',
  errorColor: '#E08B90',
  successColor: '#87B58C',

  toolCardBackgroundColor: '#262A25',
  toolCardBorderColor: '#3A4038',

  codeBackgroundColor: '#191C19',
  codeForegroundColor: '#D6DBD1',
  syntaxKeywordColor: '#A3C1A9',
  syntaxStringColor: '#C9B37E',
  syntaxCommentColor: '#8A9285',
  syntaxNumberColor: '#D3A6C6',
  syntaxFunctionColor: '#9FC7D6',

  terminalBackgroundColor: '#141713',
  terminalForegroundColor: '#D6DBD1',
  terminalCursorColor: '#E7EAE3',
  terminalAnsiBlackColor: '#141713',
  terminalAnsiRedColor: '#E08B90',
  terminalAnsiGreenColor: '#87B58C',
  terminalAnsiYellowColor: '#C7A15A',
  terminalAnsiBlueColor: '#9FC7D6',
  terminalAnsiMagentaColor: '#D3A6C6',
  terminalAnsiCyanColor: '#8FBCBC',
  terminalAnsiWhiteColor: '#E7EAE3',
  terminalAnsiBrightBlackColor: '#5A6157',
  terminalAnsiBrightRedColor: '#F0A7AC',
  terminalAnsiBrightGreenColor: '#A0CBA5',
  terminalAnsiBrightYellowColor: '#DCBC79',
  terminalAnsiBrightBlueColor: '#B8DAE6',
  terminalAnsiBrightMagentaColor: '#E4C0D8',
  terminalAnsiBrightCyanColor: '#AED3D3',
  terminalAnsiBrightWhiteColor: '#F4F6F1',

  radiusSmall: '6px',
  radiusMedium: '10px',
  radiusLarge: '14px',
  spacingScale: 1,
  animationDurationMs: 200,
};

const LIGHT: ThemeTokens = {
  windowBackgroundColor: '#FAF9F6',
  titleBarBackgroundColor: '#F0EFEB',
  sidebarLeftBackgroundColor: '#F0EFEB',
  sidebarRightBackgroundColor: '#F5F4F0',
  statusBarBackgroundColor: '#F0EFEB',
  surfaceBackgroundColor: '#FFFFFF',
  elevatedSurfaceBackgroundColor: '#FFFFFF',

  chatInputBackgroundColor: '#FFFFFF',
  chatBubbleUserBackgroundColor: '#ECEFE8',
  chatBubbleAssistantBackgroundColor: '#FAF9F6',

  bodyTextColor: '#2B2E29',
  mutedTextColor: '#5A5F57',
  linkColor: '#4C6B54',

  accentColor: '#65816D',
  accentHoverColor: '#56715E',
  accentActiveColor: '#4B6453',
  accentTextColor: '#060B08',

  buttonPrimaryBackgroundColor: '#56715E',
  buttonPrimaryHoverColor: '#4E6855',
  buttonPrimaryActiveColor: '#47614F',
  buttonPrimaryDisabledColor: '#D9DAD4',
  buttonPrimaryTextColor: '#FAF9F6',

  inputBackgroundColor: '#FFFFFF',
  inputBorderColor: '#D9DAD4',
  placeholderColor: '#6E7466',
  focusRingColor: '#4C6B54',
  selectionBackgroundColor: '#DCE5DC',
  selectionTextColor: '#2B2E29',

  borderColor: '#DDDDD6',
  dividerColor: '#E4E3DD',
  hoverBackgroundColor: '#ECEBE6',
  selectedBackgroundColor: '#E7E9E2',

  warningColor: '#8A6D2F',
  errorColor: '#B3454C',
  successColor: '#43754A',

  toolCardBackgroundColor: '#F3F2EE',
  toolCardBorderColor: '#DDDDD6',

  codeBackgroundColor: '#F0EFEB',
  codeForegroundColor: '#33362F',
  syntaxKeywordColor: '#4C6B54',
  syntaxStringColor: '#7A5A2E',
  syntaxCommentColor: '#838879',
  syntaxNumberColor: '#7A4E70',
  syntaxFunctionColor: '#3C6A78',

  terminalBackgroundColor: '#1D201C',
  terminalForegroundColor: '#E7EAE3',
  terminalCursorColor: '#E7EAE3',
  terminalAnsiBlackColor: '#1D201C',
  terminalAnsiRedColor: '#E08B90',
  terminalAnsiGreenColor: '#87B58C',
  terminalAnsiYellowColor: '#C7A15A',
  terminalAnsiBlueColor: '#9FC7D6',
  terminalAnsiMagentaColor: '#D3A6C6',
  terminalAnsiCyanColor: '#8FBCBC',
  terminalAnsiWhiteColor: '#E7EAE3',
  terminalAnsiBrightBlackColor: '#6B7268',
  terminalAnsiBrightRedColor: '#F0A7AC',
  terminalAnsiBrightGreenColor: '#A0CBA5',
  terminalAnsiBrightYellowColor: '#DCBC79',
  terminalAnsiBrightBlueColor: '#B8DAE6',
  terminalAnsiBrightMagentaColor: '#E4C0D8',
  terminalAnsiBrightCyanColor: '#AED3D3',
  terminalAnsiBrightWhiteColor: '#F4F6F1',

  radiusSmall: '6px',
  radiusMedium: '10px',
  radiusLarge: '14px',
  spacingScale: 1,
  animationDurationMs: 200,
};

/** All semantic token keys (drives editor forms and completeness checks). */
export function semanticTokenKeys(): (keyof ThemeTokens)[] {
  return Object.keys(DARK) as (keyof ThemeTokens)[];
}

export const COLOR_TOKEN_KEYS: (keyof ThemeTokens)[] = (
  Object.keys(DARK) as (keyof ThemeTokens)[]
).filter((k) => k.endsWith('Color'));

const FAMILY_BASE: Record<ThemeMode, ThemeTokens> = { light: LIGHT, dark: DARK };

/** Полный набор токенов для палитры-семени (один источник для продукта и Lab). */
export function deriveTokensForSeed(mode: ThemeMode, seed: PaletteSeed): ThemeTokens {
  return deriveTheme(FAMILY_BASE[mode], seed);
}

function toPreset(palette: ThemePalette): ThemePreset | null {
  if (palette.custom) return null;
  return {
    id: palette.id as BuiltinPresetId,
    label: palette.label,
    ...(palette.attribution ? { attribution: palette.attribution } : {}),
    immutable: true,
    tokens: deriveTokensForSeed(palette.mode, palette.seed),
  };
}

export const THEME_PRESETS: Record<BuiltinPresetId, ThemePreset> = Object.fromEntries(
  [...LIGHT_PALETTES, ...DARK_PALETTES]
    .map(toPreset)
    .filter((p): p is ThemePreset => p !== null)
    .map((p) => [p.id, p]),
) as Record<BuiltinPresetId, ThemePreset>;

/** Палитра, выбранная пользователем (встроенная или своя). */
export function resolvePalette(
  paletteId: ThemePresetId,
  mode: ThemeMode,
  customSeeds: Record<ThemeMode, PaletteSeed>,
): { mode: ThemeMode; seed: PaletteSeed; label: string } {
  const customId = CUSTOM_PALETTE_ID[mode];
  if (paletteId === customId) {
    const palette = PALETTES_BY_MODE[mode].find((p) => p.id === customId);
    return { mode, seed: customSeeds[mode], label: palette?.label ?? 'Своя тема' };
  }
  const builtin = THEME_PRESETS[paletteId as BuiltinPresetId];
  if (builtin) {
    const palette = PALETTES_BY_MODE[mode].find((p) => p.id === builtin.id);
    return { mode, seed: palette?.seed ?? (builtin.id === 'light' ? LIGHT_PALETTES[0].seed : DARK_PALETTES[0].seed), label: builtin.label };
  }
  const fallback = PALETTES_BY_MODE[mode][0];
  return { mode, seed: fallback.seed, label: fallback.label };
}

/** Токены для выбранной палитры (продукт и Lab используют этот вызов). */
export function resolveThemeTokens(
  paletteId: ThemePresetId,
  mode: ThemeMode,
  customSeeds: Record<ThemeMode, PaletteSeed>,
): ThemeTokens {
  const resolved = resolvePalette(paletteId, mode, customSeeds);
  return deriveTokensForSeed(resolved.mode, resolved.seed);
}
