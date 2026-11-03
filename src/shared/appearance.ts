/**
 * Versioned Desktop-only appearance settings (Issue #21 §9.1 item 5).
 *
 * This is the ONLY store for theme/typography/layout preferences. It never
 * writes to `~/.pi`, Pi sessions, `auth.json` or module-state. Every field is
 * validated independently and repaired to its default on corruption; an
 * unknown FUTURE version falls back to defaults instead of crashing.
 *
 * v2 (UI Integration): тема описывается режимом (light/dark), палитрой этого
 * режима и четырьмя цветами «своей» палитры на режим. Миграция из v1
 * неразрушающая: выбранная тема, свои цвета и раскладка сохраняются.
 */
import {
  THEME_PRESETS,
  resolveThemeTokens,
  type BuiltinPresetId,
  type ThemeMode,
  type ThemePresetId,
  type ThemeTokens,
} from './design/presets';
import { COLOR_TOKEN_KEYS } from './design/presets';
import {
  DEFAULT_CUSTOM_SEEDS,
  FONT_CHOICES,
  SYSTEM_FONT_AREAS,
  SYSTEM_FONT_STACK,
  fontIdFromStack,
  fontStackById,
  type PaletteSeed,
} from './design/palettes';

export const APPEARANCE_VERSION = 2;

export type TypographyArea =
  | 'ui'
  | 'sidebar'
  | 'chatInput'
  | 'chatResponse'
  | 'code'
  | 'toolOutput'
  | 'terminal'
  | 'statusBar';

export interface TypographyZone {
  fontFamily: string;
  fontSizePx: number;
  lineHeight: number;
  weight: number;
}

export interface AppearanceTheme {
  /** Активный режим: определяет, какие пять/четыре палитры показывать. */
  mode: ThemeMode;
  /** Выбранная палитра на каждый режим (независимо). */
  preset: Record<ThemeMode, ThemePresetId>;
  /** Четыре цвета «своей» палитры на каждый режим. */
  custom: Record<ThemeMode, PaletteSeed>;
}

export interface AppearanceLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightVisible: boolean;
  terminalSlotHeight: number;
  /** D2: терминальный док под центром скрыт/показан; переживает перезапуск. */
  terminalVisible: boolean;
}

export interface AppearanceSettings {
  version: number;
  theme: AppearanceTheme;
  typography: Record<TypographyArea, TypographyZone>;
  layout: AppearanceLayout;
}

/** Системные области: шрифт неизменяем, размер фиксирован контрактом. */
const SYSTEM_ZONE_SIZES: Partial<Record<TypographyArea, { size: number; lineHeight: number; weight: number }>> = {
  ui: { size: 13, lineHeight: 1.4, weight: 400 },
  sidebar: { size: 13, lineHeight: 1.45, weight: 400 },
  chatInput: { size: 14, lineHeight: 1.5, weight: 400 },
  statusBar: { size: 12, lineHeight: 1.4, weight: 400 },
};

const DEFAULT_TYPOGRAPHY: Record<TypographyArea, TypographyZone> = {
  ui: { fontFamily: SYSTEM_FONT_STACK, fontSizePx: 13, lineHeight: 1.4, weight: 400 },
  sidebar: { fontFamily: SYSTEM_FONT_STACK, fontSizePx: 13, lineHeight: 1.45, weight: 400 },
  chatInput: { fontFamily: SYSTEM_FONT_STACK, fontSizePx: 14, lineHeight: 1.5, weight: 400 },
  chatResponse: { fontFamily: fontStackById('consolas'), fontSizePx: 14, lineHeight: 1.55, weight: 400 },
  code: { fontFamily: fontStackById('consolas'), fontSizePx: 13, lineHeight: 1.5, weight: 400 },
  toolOutput: { fontFamily: fontStackById('consolas'), fontSizePx: 13, lineHeight: 1.5, weight: 400 },
  terminal: { fontFamily: fontStackById('consolas'), fontSizePx: 13, lineHeight: 1.5, weight: 400 },
  statusBar: { fontFamily: SYSTEM_FONT_STACK, fontSizePx: 12, lineHeight: 1.4, weight: 400 },
};

export const TYPOGRAPHY_AREAS = Object.keys(DEFAULT_TYPOGRAPHY) as TypographyArea[];

export function defaultTypography(): Record<TypographyArea, TypographyZone> {
  return structuredClone(DEFAULT_TYPOGRAPHY);
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  version: APPEARANCE_VERSION,
  theme: {
    mode: 'dark',
    preset: { light: 'light', dark: 'dark' },
    custom: { light: { ...DEFAULT_CUSTOM_SEEDS.light }, dark: { ...DEFAULT_CUSTOM_SEEDS.dark } },
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: {
    leftWidth: 321,
    rightWidth: 385,
    leftCollapsed: false,
    rightVisible: false,
    terminalSlotHeight: 231,
    terminalVisible: true,
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repairNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function repairString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 400
    ? value
    : fallback;
}

function repairBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function repairHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toUpperCase() : fallback;
}

function repairSeed(value: unknown, fallback: PaletteSeed): PaletteSeed {
  if (!isRecord(value)) return { ...fallback };
  return {
    window: repairHex(value.window, fallback.window),
    panel: repairHex(value.panel, fallback.panel),
    accent: repairHex(value.accent, fallback.accent),
    text: repairHex(value.text, fallback.text),
  };
}

const ALL_PRESET_IDS: ThemePresetId[] = [
  ...(Object.keys(THEME_PRESETS) as BuiltinPresetId[]),
  'customLight',
  'customDark',
];

const LEGACY_PRESET_MAP: Record<string, { mode: ThemeMode; preset: ThemePresetId }> = {
  dark: { mode: 'dark', preset: 'dark' },
  light: { mode: 'light', preset: 'light' },
  claude: { mode: 'dark', preset: 'claudeDark' },
  codex: { mode: 'dark', preset: 'codexDark' },
  claudeLight: { mode: 'light', preset: 'claudeLight' },
  codexLight: { mode: 'light', preset: 'codexLight' },
};

function seedFromLegacyTokens(value: unknown): PaletteSeed | null {
  if (!isRecord(value)) return null;
  const window = value.windowBackgroundColor;
  const panel = value.sidebarLeftBackgroundColor ?? value.sidebarRightBackgroundColor;
  const accent = value.accentColor;
  const text = value.bodyTextColor;
  if (typeof window !== 'string' || typeof panel !== 'string' || typeof accent !== 'string' || typeof text !== 'string') {
    return null;
  }
  if (!HEX.test(window) || !HEX.test(panel) || !HEX.test(accent) || !HEX.test(text)) return null;
  return { window: window.toUpperCase(), panel: panel.toUpperCase(), accent: accent.toUpperCase(), text: text.toUpperCase() };
}

function isDarkHex(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 <= 0.5;
}

/** v1: одна тема (preset + custom tokens) — переносим в режим без потери выбора. */
function migrateThemeV1(themeRaw: Record<string, unknown>): AppearanceTheme {
  const theme: AppearanceTheme = {
    mode: 'dark',
    preset: { ...DEFAULT_APPEARANCE.theme.preset },
    custom: {
      light: { ...DEFAULT_APPEARANCE.theme.custom.light },
      dark: { ...DEFAULT_APPEARANCE.theme.custom.dark },
    },
  };
  const legacy = typeof themeRaw.preset === 'string' ? themeRaw.preset : 'dark';
  if (legacy === 'custom') {
    const seed = seedFromLegacyTokens(themeRaw.custom);
    if (seed) {
      const mode: ThemeMode = isDarkHex(seed.window) ? 'dark' : 'light';
      theme.mode = mode;
      theme.custom[mode] = seed;
      theme.preset[mode] = mode === 'light' ? 'customLight' : 'customDark';
    }
    return theme;
  }
  const mapped = LEGACY_PRESET_MAP[legacy];
  if (mapped) {
    theme.mode = mapped.mode;
    theme.preset[mapped.mode] = mapped.preset;
  }
  return theme;
}

function repairThemeV2(themeRaw: Record<string, unknown>): AppearanceTheme {
  const mode: ThemeMode = themeRaw.mode === 'light' ? 'light' : themeRaw.mode === 'dark' ? 'dark' : 'dark';
  const presetRaw = isRecord(themeRaw.preset) ? themeRaw.preset : {};
  const customRaw = isRecord(themeRaw.custom) ? themeRaw.custom : {};
  const presetFor = (m: ThemeMode, fallback: ThemePresetId): ThemePresetId => {
    const candidate = presetRaw[m];
    if (typeof candidate === 'string' && ALL_PRESET_IDS.includes(candidate as ThemePresetId)) {
      return candidate as ThemePresetId;
    }
    return fallback;
  };
  return {
    mode,
    preset: {
      light: presetFor('light', DEFAULT_APPEARANCE.theme.preset.light),
      dark: presetFor('dark', DEFAULT_APPEARANCE.theme.preset.dark),
    },
    custom: {
      light: repairSeed(customRaw.light, DEFAULT_APPEARANCE.theme.custom.light),
      dark: repairSeed(customRaw.dark, DEFAULT_APPEARANCE.theme.custom.dark),
    },
  };
}

/** Системные области всегда системным шрифтом и контрактным кеглем. */
function normalizeZone(area: TypographyArea, zone: TypographyZone): TypographyZone {
  const fixed = SYSTEM_ZONE_SIZES[area];
  if (fixed) {
    return { fontFamily: SYSTEM_FONT_STACK, fontSizePx: fixed.size, lineHeight: fixed.lineHeight, weight: fixed.weight };
  }
  const family = FONT_CHOICES.some((f) => f.stack === zone.fontFamily)
    ? zone.fontFamily
    : fontStackById(fontIdFromStack(zone.fontFamily));
  return { ...zone, fontFamily: family };
}

function repairTypography(raw: unknown): Record<TypographyArea, TypographyZone> {
  const source = isRecord(raw) ? raw : {};
  return (Object.keys(DEFAULT_TYPOGRAPHY) as TypographyArea[]).reduce(
    (acc, area) => {
      const zone = isRecord(source[area]) ? source[area] : {};
      const fallback = DEFAULT_TYPOGRAPHY[area];
      acc[area] = normalizeZone(area, {
        fontFamily: repairString(zone.fontFamily, fallback.fontFamily),
        fontSizePx: repairNumber(zone.fontSizePx, 8, 40, fallback.fontSizePx),
        lineHeight: repairNumber(zone.lineHeight, 1, 3, fallback.lineHeight),
        weight: repairNumber(zone.weight, 100, 900, fallback.weight),
      });
      return acc;
    },
    {} as Record<TypographyArea, TypographyZone>,
  );
}

function repairLayout(raw: unknown): AppearanceLayout {
  const layoutRaw = isRecord(raw) ? raw : {};
  return {
    leftWidth: repairNumber(layoutRaw.leftWidth, 200, 480, DEFAULT_APPEARANCE.layout.leftWidth),
    rightWidth: repairNumber(layoutRaw.rightWidth, 240, 560, DEFAULT_APPEARANCE.layout.rightWidth),
    leftCollapsed: repairBool(layoutRaw.leftCollapsed, DEFAULT_APPEARANCE.layout.leftCollapsed),
    rightVisible: repairBool(layoutRaw.rightVisible, DEFAULT_APPEARANCE.layout.rightVisible),
    terminalSlotHeight: repairNumber(
      layoutRaw.terminalSlotHeight,
      120,
      600,
      DEFAULT_APPEARANCE.layout.terminalSlotHeight,
    ),
    terminalVisible: repairBool(layoutRaw.terminalVisible, DEFAULT_APPEARANCE.layout.terminalVisible),
  };
}

/**
 * Per-field migration/repair. Order matters: an unknown future version is not
 * something we can interpret, so it falls back to full defaults (§9.1
 * «миграцией/сбросом» — forward incompatibility must never crash or render
 * garbage). Unknown/older versions are migrated field by field.
 */
export function migrateAppearance(raw: unknown): AppearanceSettings {
  if (!isRecord(raw)) return structuredClone(DEFAULT_APPEARANCE);
  const version = raw.version;
  if (version !== undefined && (typeof version !== 'number' || version > APPEARANCE_VERSION)) {
    return structuredClone(DEFAULT_APPEARANCE);
  }
  const themeRaw = isRecord(raw.theme) ? raw.theme : {};
  // v2 узнаётся по объектной форме preset; отсутствующий custom чинится дефолтами.
  const isV2 = version === APPEARANCE_VERSION && isRecord(themeRaw.preset);
  return {
    version: APPEARANCE_VERSION,
    theme: isV2 ? repairThemeV2(themeRaw) : migrateThemeV1(themeRaw),
    typography: repairTypography(raw.typography),
    layout: repairLayout(raw.layout),
  };
}

/** Токены выбранной палитры — единственный путь от настроек к CSS-переменным. */
export function appearanceThemeTokens(theme: AppearanceTheme): ThemeTokens {
  return resolveThemeTokens(theme.preset[theme.mode], theme.mode, theme.custom);
}

/** Настраиваемый слот шрифта: семейство берётся из выбранного моношрифта. */
export function setSlotFont(
  typography: AppearanceSettings['typography'],
  areas: readonly TypographyArea[],
  fontId: string,
): Record<TypographyArea, TypographyZone> {
  const stack = fontStackById(fontId);
  const next = { ...typography };
  for (const area of areas) next[area] = { ...next[area], fontFamily: stack };
  return next;
}

export function isSystemArea(area: TypographyArea): boolean {
  return (SYSTEM_FONT_AREAS as readonly TypographyArea[]).includes(area);
}

export { COLOR_TOKEN_KEYS };
