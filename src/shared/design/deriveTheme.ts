/**
 * Вывод полного набора токенов из четырёх пользовательских цветов.
 *
 * Пользователь задаёт ровно четыре цвета: рабочая область, обе боковые панели,
 * акцент и основной текст. Остальные токены выводятся детерминированно, поэтому
 * выбор палитры честно меняет весь интерфейс, а не только образцы. Обе боковые
 * панели получают один цвет по построению.
 *
 * Один источник истины для продукта и Design Lab (Issue #21 §9.2).
 */
import type { ThemeTokens } from './presets';
import { contrastRatio } from './contrast';

export interface PaletteSeed {
  window: string;
  panel: string;
  accent: string;
  text: string;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** t=0 → a, t=1 → b */
export function mix(a: string, b: string, t: number): string {
  const A = parse(a);
  const B = parse(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ближайшее к fg значение, дающее контраст ≥ min на bg. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.5 ? '#000000' : '#FFFFFF';
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const candidate = mix(fg, target, t);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return target;
}

/** Последовательная гарантия AA на нескольких фонах. */
export function ensureOn(color: string, backgrounds: string[], min = 4.5): string {
  let out = color;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const bg of backgrounds) out = ensureContrast(out, bg, min);
  }
  return out;
}

/** Шаг поверхности в направлении «дальше от фона окна». */
function step(base: string, amount: number): string {
  const dark = luminance(base) < 0.4;
  return mix(base, dark ? '#FFFFFF' : '#000000', dark ? amount : amount * 0.6);
}

/** Полный набор токенов из четырёх цветов; `base` даёт радиусы, статусы и ANSI. */
export function deriveTheme(base: ThemeTokens, seed: PaletteSeed): ThemeTokens {
  /**
   * Направление поверхности зависит от темы: в тёмной тема «выступает» светлее
   * окна, в светлой — уходит к чистому белому (как в утверждённом Design Lab,
   * где surface = #FFFFFF при окне #FAF9F6).
   */
  const dark = luminance(seed.window) < 0.4;
  const surface = dark ? step(seed.window, 0.06) : mix(seed.window, '#FFFFFF', 0.8);
  const elevated = dark ? step(surface, 0.05) : surface;
  /**
   * Границы выводятся ОТ ПОВЕРХНОСТИ/ПАНЕЛИ, а не от цвета текста: иначе
   * тёмная тема получает почти белые обводки (#C6C9C3 вместо #3A3D39).
   * Значения откалиброваны по утверждённым токенам Design Lab (HEAD presets).
   */
  const border = mix(surface, seed.text, dark ? 0.09 : 0.14);
  const divider = mix(seed.panel, seed.text, dark ? 0.1 : 0.06);
  const codeBg = dark ? step(seed.window, 0.1) : mix(seed.window, '#FFFFFF', 0.55);
  const terminalBg = dark ? step(seed.window, 0.14) : mix(seed.window, '#000000', 0.04);
  const muted = ensureOn(mix(seed.text, surface, dark ? 0.42 : 0.24), [seed.window, surface, elevated]);
  const accentText =
    contrastRatio('#FFFFFF', seed.accent) >= contrastRatio('#000000', seed.accent) ? '#FFFFFF' : '#000000';
  const link = ensureOn(mix(seed.accent, dark ? '#FFFFFF' : '#000000', dark ? 0.35 : 0.2), [surface, seed.window, elevated]);
  const inputBg = surface;
  return {
    ...base,
    windowBackgroundColor: seed.window,
    titleBarBackgroundColor: seed.panel,
    sidebarLeftBackgroundColor: seed.panel,
    sidebarRightBackgroundColor: seed.panel,
    statusBarBackgroundColor: seed.panel,
    surfaceBackgroundColor: surface,
    elevatedSurfaceBackgroundColor: elevated,
    chatInputBackgroundColor: inputBg,
    chatBubbleUserBackgroundColor: mix(surface, seed.accent, 0.1),
    chatBubbleAssistantBackgroundColor: surface,
    bodyTextColor: seed.text,
    mutedTextColor: muted,
    linkColor: link,
    accentColor: seed.accent,
    accentHoverColor: mix(seed.accent, dark ? '#FFFFFF' : '#000000', 0.12),
    accentActiveColor: mix(seed.accent, '#000000', dark ? 0.12 : 0.26),
    accentTextColor: accentText,
    buttonPrimaryBackgroundColor: seed.accent,
    buttonPrimaryHoverColor: mix(seed.accent, dark ? '#FFFFFF' : '#000000', 0.12),
    buttonPrimaryActiveColor: mix(seed.accent, '#000000', dark ? 0.12 : 0.26),
    buttonPrimaryDisabledColor: border,
    buttonPrimaryTextColor: accentText,
    inputBackgroundColor: inputBg,
    inputBorderColor: mix(inputBg, seed.text, dark ? 0.11 : 0.15),
    placeholderColor: ensureContrast(mix(seed.text, inputBg, 0.45), inputBg, 4.5),
    focusRingColor: seed.accent,
    selectionBackgroundColor: seed.accent,
    selectionTextColor: accentText,
    borderColor: border,
    dividerColor: divider,
    hoverBackgroundColor: dark ? mix(surface, seed.accent, 0.07) : mix(surface, seed.text, 0.09),
    selectedBackgroundColor: dark ? mix(surface, seed.accent, 0.04) : mix(surface, seed.text, 0.11),
    toolCardBackgroundColor: surface,
    toolCardBorderColor: border,
    codeBackgroundColor: codeBg,
    codeForegroundColor: ensureContrast(seed.text, codeBg, 4.5),
    syntaxKeywordColor: ensureContrast(link, codeBg, 4.5),
    syntaxStringColor: ensureContrast(base.successColor, codeBg, 4.5),
    syntaxCommentColor: ensureContrast(mix(seed.text, seed.window, 0.35), codeBg, 4.5),
    syntaxNumberColor: ensureContrast(base.warningColor, codeBg, 4.5),
    syntaxFunctionColor: ensureContrast(link, codeBg, 4.5),
    terminalBackgroundColor: terminalBg,
    terminalForegroundColor: ensureContrast(seed.text, terminalBg, 4.5),
    terminalCursorColor: seed.accent,
  };
}
