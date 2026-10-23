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

export type ThemePresetId = 'dark' | 'light' | 'claude' | 'codex';

export const PRESET_IDS: readonly ThemePresetId[] = ['dark', 'light', 'claude', 'codex'] as const;

export interface ThemePreset {
  id: ThemePresetId;
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

/** Warm light inspired-by preset — NOT an official Claude palette (§9.2). */
const CLAUDE: ThemeTokens = {
  windowBackgroundColor: '#F4F1EA',
  titleBarBackgroundColor: '#EDE9E0',
  sidebarLeftBackgroundColor: '#EDE9E0',
  sidebarRightBackgroundColor: '#F1EDE5',
  statusBarBackgroundColor: '#EDE9E0',
  surfaceBackgroundColor: '#FBFAF6',
  elevatedSurfaceBackgroundColor: '#FFFFFF',

  chatInputBackgroundColor: '#FFFFFF',
  chatBubbleUserBackgroundColor: '#EAE4D7',
  chatBubbleAssistantBackgroundColor: '#F4F1EA',

  bodyTextColor: '#26241F',
  mutedTextColor: '#5F5A50',
  linkColor: '#8A4B2A',

  accentColor: '#B85C38',
  accentHoverColor: '#A55231',
  accentActiveColor: '#91482A',
  accentTextColor: '#050402',

  buttonPrimaryBackgroundColor: '#A55231',
  buttonPrimaryHoverColor: '#984B2C',
  buttonPrimaryActiveColor: '#91482A',
  buttonPrimaryDisabledColor: '#DDD7CB',
  buttonPrimaryTextColor: '#FAF7F0',

  inputBackgroundColor: '#FFFFFF',
  inputBorderColor: '#DAD4C7',
  placeholderColor: '#6E685C',
  focusRingColor: '#8A4B2A',
  selectionBackgroundColor: '#EFE3D6',
  selectionTextColor: '#26241F',

  borderColor: '#DED8CB',
  dividerColor: '#E7E1D5',
  hoverBackgroundColor: '#EEEAE0',
  selectedBackgroundColor: '#EDE6D9',

  warningColor: '#8A6D2F',
  errorColor: '#B3454C',
  successColor: '#43754A',

  toolCardBackgroundColor: '#EFEBE1',
  toolCardBorderColor: '#DED8CB',

  codeBackgroundColor: '#EDE8DD',
  codeForegroundColor: '#33302A',
  syntaxKeywordColor: '#8A4B2A',
  syntaxStringColor: '#7A5A2E',
  syntaxCommentColor: '#8B8477',
  syntaxNumberColor: '#7A4E70',
  syntaxFunctionColor: '#3C6A78',

  terminalBackgroundColor: '#1F1D19',
  terminalForegroundColor: '#EDE8DD',
  terminalCursorColor: '#EDE8DD',
  terminalAnsiBlackColor: '#1F1D19',
  terminalAnsiRedColor: '#E08B90',
  terminalAnsiGreenColor: '#87B58C',
  terminalAnsiYellowColor: '#C7A15A',
  terminalAnsiBlueColor: '#9FC7D6',
  terminalAnsiMagentaColor: '#D3A6C6',
  terminalAnsiCyanColor: '#8FBCBC',
  terminalAnsiWhiteColor: '#EDE8DD',
  terminalAnsiBrightBlackColor: '#6B665C',
  terminalAnsiBrightRedColor: '#F0A7AC',
  terminalAnsiBrightGreenColor: '#A0CBA5',
  terminalAnsiBrightYellowColor: '#DCBC79',
  terminalAnsiBrightBlueColor: '#B8DAE6',
  terminalAnsiBrightMagentaColor: '#E4C0D8',
  terminalAnsiBrightCyanColor: '#AED3D3',
  terminalAnsiBrightWhiteColor: '#F7F4ED',

  radiusSmall: '6px',
  radiusMedium: '10px',
  radiusLarge: '14px',
  spacingScale: 1,
  animationDurationMs: 200,
};

/** Cold dark inspired-by preset — NOT an official Codex palette (§9.2). */
const CODEX: ThemeTokens = {
  windowBackgroundColor: '#17191C',
  titleBarBackgroundColor: '#101214',
  sidebarLeftBackgroundColor: '#101214',
  sidebarRightBackgroundColor: '#141619',
  statusBarBackgroundColor: '#101214',
  surfaceBackgroundColor: '#1F2226',
  elevatedSurfaceBackgroundColor: '#262A2F',

  chatInputBackgroundColor: '#1F2226',
  chatBubbleUserBackgroundColor: '#262A2F',
  chatBubbleAssistantBackgroundColor: '#17191C',

  bodyTextColor: '#E8EAED',
  mutedTextColor: '#9BA1A8',
  linkColor: '#7FB3A2',

  accentColor: '#4E8F77',
  accentHoverColor: '#5AA089',
  accentActiveColor: '#448069',
  accentTextColor: '#0F1214',

  buttonPrimaryBackgroundColor: '#4E8F77',
  buttonPrimaryHoverColor: '#5AA089',
  buttonPrimaryActiveColor: '#448069',
  buttonPrimaryDisabledColor: '#2A2E33',
  buttonPrimaryTextColor: '#0F1214',

  inputBackgroundColor: '#1F2226',
  inputBorderColor: '#2E3238',
  placeholderColor: '#868D96',
  focusRingColor: '#7FB3A2',
  selectionBackgroundColor: '#27403A',
  selectionTextColor: '#E8EAED',

  borderColor: '#2E3238',
  dividerColor: '#2E3238',
  hoverBackgroundColor: '#23262B',
  selectedBackgroundColor: '#21252A',

  warningColor: '#C9A55C',
  errorColor: '#E49198',
  successColor: '#79B58A',

  toolCardBackgroundColor: '#1B1E22',
  toolCardBorderColor: '#2E3238',

  codeBackgroundColor: '#101214',
  codeForegroundColor: '#DADDE2',
  syntaxKeywordColor: '#7FB3A2',
  syntaxStringColor: '#CDBB86',
  syntaxCommentColor: '#767C84',
  syntaxNumberColor: '#CFA5C4',
  syntaxFunctionColor: '#93BFD3',

  terminalBackgroundColor: '#0C0D0F',
  terminalForegroundColor: '#DADDE2',
  terminalCursorColor: '#E8EAED',
  terminalAnsiBlackColor: '#0C0D0F',
  terminalAnsiRedColor: '#E49198',
  terminalAnsiGreenColor: '#79B58A',
  terminalAnsiYellowColor: '#C9A55C',
  terminalAnsiBlueColor: '#93BFD3',
  terminalAnsiMagentaColor: '#CFA5C4',
  terminalAnsiCyanColor: '#86B9B9',
  terminalAnsiWhiteColor: '#E8EAED',
  terminalAnsiBrightBlackColor: '#565C64',
  terminalAnsiBrightRedColor: '#F1ABB1',
  terminalAnsiBrightGreenColor: '#93CBA4',
  terminalAnsiBrightYellowColor: '#E0C07A',
  terminalAnsiBrightBlueColor: '#AED4E3',
  terminalAnsiBrightMagentaColor: '#E1BCDC',
  terminalAnsiBrightCyanColor: '#A3CDCD',
  terminalAnsiBrightWhiteColor: '#F2F4F7',

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

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  dark: {
    id: 'dark',
    label: 'Тёмная',
    immutable: true,
    tokens: DARK,
  },
  light: {
    id: 'light',
    label: 'Светлая',
    immutable: true,
    tokens: LIGHT,
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    attribution: 'Вдохновлённый пресет (inspired-by); не является официальной палитрой Claude.',
    immutable: true,
    tokens: CLAUDE,
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    attribution: 'Вдохновлённый пресет (inspired-by); не является официальной палитрой Codex.',
    immutable: true,
    tokens: CODEX,
  },
};
