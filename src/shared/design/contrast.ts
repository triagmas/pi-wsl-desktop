/**
 * WCAG 2.x relative luminance / contrast math for the theme system.
 * Issue #21 §9.2: semantic contrast checks in the custom theme editor.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

function assertHex(value: string, label: string): string {
  if (!HEX.test(value)) {
    throw new Error(`${label} must be #rrggbb hex, got: ${JSON.stringify(value)}`);
  }
  return value;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const clean = assertHex(hex, 'color').slice(1);
  const r = channel(parseInt(clean.slice(0, 2), 16));
  const g = channel(parseInt(clean.slice(2, 4), 16));
  const b = channel(parseInt(clean.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors: 1 (same) .. 21 (black/white). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA normal-text threshold (4.5:1) for foreground readability on a background. */
export function meetsAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}
