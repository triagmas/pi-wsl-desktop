/**
 * Девять палитр контракта: 5 светлых и 4 тёмных (включая «свою» в каждом режиме).
 * Палитра описывается четырьмя цветами; полный набор токенов выводит deriveTheme.
 * Один источник для продукта и Design Lab.
 */
import type { PaletteSeed } from './deriveTheme';

export type { PaletteSeed } from './deriveTheme';

export interface ThemePalette {
  id: string;
  label: string;
  mode: 'light' | 'dark';
  seed: PaletteSeed;
  /** «Своя» палитра: редактируется четырьмя полями, хранится в appearance. */
  custom?: boolean;
  attribution?: string;
}

export const LIGHT_PALETTES: ThemePalette[] = [
  { id: 'light', label: 'Светлая', mode: 'light', seed: { window: '#FAF9F6', panel: '#F0EFEB', accent: '#65816D', text: '#2B2E29' } },
  { id: 'astra', label: 'Astra', mode: 'light', seed: { window: '#F4F7FA', panel: '#EAF0F6', accent: '#0E7490', text: '#16202B' } },
  { id: 'claudeLight', label: 'Claude Light', mode: 'light', seed: { window: '#FBF7F2', panel: '#F5EFE7', accent: '#B4582F', text: '#2A241E' }, attribution: 'Вдохновлённый пресет (inspired-by), не официальная палитра.' },
  { id: 'codexLight', label: 'Codex Light', mode: 'light', seed: { window: '#F7F8FA', panel: '#EFF1F5', accent: '#3563D8', text: '#1A1D23' }, attribution: 'Вдохновлённый пресет (inspired-by), не официальная палитра.' },
  { id: 'customLight', label: 'Своя светлая', mode: 'light', custom: true, seed: { window: '#FAF9F6', panel: '#F0EFEB', accent: '#0E7490', text: '#2B2E29' } },
];

export const DARK_PALETTES: ThemePalette[] = [
  { id: 'dark', label: 'Тёмная', mode: 'dark', seed: { window: '#20221F', panel: '#191C19', accent: '#78957C', text: '#E7EAE3' } },
  { id: 'claudeDark', label: 'Claude Dark', mode: 'dark', seed: { window: '#1F1D1A', panel: '#171512', accent: '#C9714A', text: '#EDE8E1' }, attribution: 'Вдохновлённый пресет (inspired-by), не официальная палитра.' },
  { id: 'codexDark', label: 'Codex Dark', mode: 'dark', seed: { window: '#17191C', panel: '#101214', accent: '#4E8F77', text: '#E8EAED' }, attribution: 'Вдохновлённый пресет (inspired-by), не официальная палитра.' },
  { id: 'customDark', label: 'Своя тёмная', mode: 'dark', custom: true, seed: { window: '#20221F', panel: '#191C19', accent: '#78957C', text: '#E7EAE3' } },
];

export const PALETTES_BY_MODE = { light: LIGHT_PALETTES, dark: DARK_PALETTES } as const;

export const CUSTOM_PALETTE_ID = { light: 'customLight', dark: 'customDark' } as const;

export const DEFAULT_CUSTOM_SEEDS: Record<'light' | 'dark', PaletteSeed> = {
  light: { ...LIGHT_PALETTES[LIGHT_PALETTES.length - 1].seed },
  dark: { ...DARK_PALETTES[DARK_PALETTES.length - 1].seed },
};

/** Закрытый список моношрифтов: проверены кириллица, диакритика, латиница. */
export const FONT_CHOICES = [
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
  { id: 'courier', label: 'Courier New', stack: '"Courier New", Consolas, monospace' },
  { id: 'lucida', label: 'Lucida Console', stack: '"Lucida Console", Consolas, monospace' },
] as const;

export type FontChoiceId = (typeof FONT_CHOICES)[number]['id'];

export const SYSTEM_FONT_STACK = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif';

/** Области, где шрифт неизменяем (меню, панели, ввод, статус). */
export const SYSTEM_FONT_AREAS = ['ui', 'sidebar', 'chatInput', 'statusBar'] as const;

/** Два настраиваемых слота: ответы Pi и код/технический вывод. */
export const FONT_SLOT_AREAS = {
  reply: ['chatResponse'],
  code: ['code', 'toolOutput', 'terminal'],
} as const;

export type FontSlot = keyof typeof FONT_SLOT_AREAS;
export const FONT_SLOT_ORDER: FontSlot[] = ['reply', 'code'];
export const FONT_SLOT_LABELS: Record<FontSlot, string> = {
  reply: 'Шрифт ответов',
  code: 'Шрифт кода',
};

export function fontStackById(id: string): string {
  return FONT_CHOICES.find((f) => f.id === id)?.stack ?? FONT_CHOICES[0].stack;
}

/** Ближайший разрешённый моношрифт для сохранённого произвольного стека. */
export function fontIdFromStack(stack: string): FontChoiceId {
  const lower = stack.toLowerCase();
  for (const choice of FONT_CHOICES) {
    if (lower.includes(choice.label.toLowerCase())) return choice.id;
  }
  return 'consolas';
}
