/**
 * Versioned Desktop-only appearance settings (Issue #21 §9.1 item 5).
 *
 * This is the ONLY store for theme/typography/layout preferences. It never
 * writes to `~/.pi`, Pi sessions, `auth.json` or module-state. Every field is
 * validated independently and repaired to its default on corruption; an
 * unknown FUTURE version falls back to defaults instead of crashing.
 */
import {
  PRESET_IDS,
  THEME_PRESETS,
  type ThemePresetId,
  type ThemeTokens,
} from './design/presets';
import { COLOR_TOKEN_KEYS } from './design/presets';

export const APPEARANCE_VERSION = 1;

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
  preset: ThemePresetId | 'custom';
  customName: string;
  /** Last cloned custom tokens; null only until the user first opens the editor. */
  custom: ThemeTokens | null;
}

export interface AppearanceLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightVisible: boolean;
  terminalSlotHeight: number;
}

export interface AppearanceSettings {
  version: number;
  theme: AppearanceTheme;
  typography: Record<TypographyArea, TypographyZone>;
  layout: AppearanceLayout;
}

const UI_STACK =
  '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const MONO_STACK =
  '"Cascadia Mono", Consolas, "Liberation Mono", "Courier New", monospace';

const DEFAULT_TYPOGRAPHY: Record<TypographyArea, TypographyZone> = {
  ui: { fontFamily: UI_STACK, fontSizePx: 14, lineHeight: 1.5, weight: 400 },
  sidebar: { fontFamily: UI_STACK, fontSizePx: 13, lineHeight: 1.45, weight: 400 },
  chatInput: { fontFamily: UI_STACK, fontSizePx: 14, lineHeight: 1.5, weight: 400 },
  chatResponse: { fontFamily: UI_STACK, fontSizePx: 15, lineHeight: 1.6, weight: 400 },
  code: { fontFamily: MONO_STACK, fontSizePx: 13, lineHeight: 1.5, weight: 400 },
  toolOutput: { fontFamily: MONO_STACK, fontSizePx: 12, lineHeight: 1.45, weight: 400 },
  terminal: { fontFamily: MONO_STACK, fontSizePx: 13, lineHeight: 1.4, weight: 400 },
  statusBar: { fontFamily: UI_STACK, fontSizePx: 12, lineHeight: 1.2, weight: 400 },
};

export const TYPOGRAPHY_AREAS = Object.keys(DEFAULT_TYPOGRAPHY) as TypographyArea[];

export function defaultTypography(): Record<TypographyArea, TypographyZone> {
  return structuredClone(DEFAULT_TYPOGRAPHY);
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  version: APPEARANCE_VERSION,
  theme: { preset: 'dark', customName: 'Моя тема', custom: structuredClone(THEME_PRESETS.dark.tokens) },
  typography: DEFAULT_TYPOGRAPHY,
  layout: { leftWidth: 260, rightWidth: 340, leftCollapsed: false, rightVisible: false, terminalSlotHeight: 240 },
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

function repairTokens(value: unknown): ThemeTokens {
  const fallback = DEFAULT_APPEARANCE.theme.custom as ThemeTokens;
  if (!isRecord(value)) return structuredClone(fallback);
  const out: Record<string, string> = {};
  for (const key of COLOR_TOKEN_KEYS) {
    const candidate = value[key as string];
    out[key as string] =
      typeof candidate === 'string' && HEX.test(candidate)
        ? candidate
        : (fallback[key as keyof ThemeTokens] as string);
  }
  // Non-color metrics ride along with the token set.
  const source = value as Partial<ThemeTokens>;
  const radius = (v: unknown, fb: string): string =>
    typeof v === 'string' && /^\d+(\.\d+)?px$/.test(v) ? v : fb;
  return {
    ...(out as unknown as ThemeTokens),
    radiusSmall: radius(source.radiusSmall, fallback.radiusSmall),
    radiusMedium: radius(source.radiusMedium, fallback.radiusMedium),
    radiusLarge: radius(source.radiusLarge, fallback.radiusLarge),
    spacingScale: repairNumber(source.spacingScale, 0.75, 1.5, fallback.spacingScale),
    animationDurationMs: repairNumber(source.animationDurationMs, 0, 1000, fallback.animationDurationMs),
  };
}

/**
 * Per-field migration/repair. Order matters: an unknown future version is not
 * something we can interpret, so it falls back to full defaults (§9.1
 * «миграцией/сбросом» — forward incompatibility must never crash or render
 * garbage).
 */
export function migrateAppearance(raw: unknown): AppearanceSettings {
  if (!isRecord(raw)) return structuredClone(DEFAULT_APPEARANCE);
  const version = raw.version;
  if (version !== undefined && (typeof version !== 'number' || version > APPEARANCE_VERSION)) {
    return structuredClone(DEFAULT_APPEARANCE);
  }
  const themeRaw = isRecord(raw.theme) ? raw.theme : {};
  const preset = themeRaw.preset;
  const typographyRaw = isRecord(raw.typography) ? raw.typography : {};
  const layoutRaw = isRecord(raw.layout) ? raw.layout : {};
  return {
    version: APPEARANCE_VERSION,
    theme: {
      preset:
        typeof preset === 'string' && ([...PRESET_IDS, 'custom'] as string[]).includes(preset)
          ? (preset as AppearanceTheme['preset'])
          : DEFAULT_APPEARANCE.theme.preset,
      customName: repairString(themeRaw.customName, DEFAULT_APPEARANCE.theme.customName),
      custom: repairTokens(themeRaw.custom),
    },
    typography: (Object.keys(DEFAULT_TYPOGRAPHY) as TypographyArea[]).reduce(
      (acc, area) => {
        const zone = isRecord(typographyRaw[area]) ? typographyRaw[area] : {};
        const fallback = DEFAULT_TYPOGRAPHY[area];
        acc[area] = {
          fontFamily: repairString(zone.fontFamily, fallback.fontFamily),
          fontSizePx: repairNumber(zone.fontSizePx, 8, 40, fallback.fontSizePx),
          lineHeight: repairNumber(zone.lineHeight, 1, 3, fallback.lineHeight),
          weight: repairNumber(zone.weight, 100, 900, fallback.weight),
        };
        return acc;
      },
      {} as Record<TypographyArea, TypographyZone>,
    ),
    layout: {
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
    },
  };
}
