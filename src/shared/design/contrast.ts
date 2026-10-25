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

/**
 * Any CSS color the renderer can produce (hex, rgb()/rgba(), hsl()/hsla()) →
 * canonical #rrggbb for contrast math. Thrown (fail-safe) on everything else:
 * named colors, var()/color-mix() and gradients are not resolvable here —
 * same "no guessing" policy as relativeLuminance.
 */
export function hexColor(color: string): string {
  const value = color.trim();
  if (HEX.test(value)) return value.toLowerCase();

  const fn = /^(rgba?)\(([^)]+)\)$/i.exec(value) ?? /^(hsla?)\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const kind = fn[1].toLowerCase().startsWith('hsl') ? 'hsl' : 'rgb';
    const nums = fn[2]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((n) => n.trim());
    const [a, b, c] = kind === 'hsl' ? parseHsl(nums) : parseRgb(nums);
    return `#${[a, b, c]
      .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  throw new Error(`color must be #rrggbb hex, got: ${JSON.stringify(color)}`);
}

function parseRgb(channels: string[]): [number, number, number] {
  if (channels.length < 3) throw new Error(`color must have 3 channels, got: ${JSON.stringify(channels)}`);
  const channel = (token: string): number => {
    if (token.endsWith('%')) {
      const pct = Number.parseFloat(token.slice(0, -1));
      if (!Number.isFinite(pct)) throw new Error(`bad rgb channel: ${JSON.stringify(token)}`);
      return (pct / 100) * 255;
    }
    const n = Number.parseFloat(token);
    if (!Number.isFinite(n)) throw new Error(`bad rgb channel: ${JSON.stringify(token)}`);
    return n;
  };
  return [channel(channels[0]), channel(channels[1]), channel(channels[2])];
}

function parseHsl(channels: string[]): [number, number, number] {
  if (channels.length < 3) throw new Error(`color must have 3 channels, got: ${JSON.stringify(channels)}`);
  const hue = Number.parseFloat(channels[0]);
  const sat = percent(channels[1], 'hsl saturation');
  const lig = percent(channels[2], 'hsl lightness');
  if (!Number.isFinite(hue)) throw new Error(`bad hsl hue: ${JSON.stringify(channels[0])}`);
  const h = ((hue % 360) + 360) % 360 / 360;
  if (sat === 0) {
    const v = lig * 255;
    return [v, v, v];
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const chan = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return (p + (q - p) * 6 * x) * 255;
    if (x < 1 / 2) return q * 255;
    if (x < 2 / 3) return (p + (q - p) * (2 / 3 - x) * 6) * 255;
    return p * 255;
  };
  return [chan(h + 1 / 3), chan(h), chan(h - 1 / 3)];
}

function percent(token: string, label: string): number {
  const n = Number.parseFloat(token.endsWith('%') ? token.slice(0, -1) : token);
  if (!Number.isFinite(n)) throw new Error(`bad ${label}: ${JSON.stringify(token)}`);
  const v = token.endsWith('%') || n > 1 ? n / 100 : n;
  if (v < 0 || v > 1) throw new Error(`bad ${label}: ${JSON.stringify(token)}`);
  return v;
}

/** AA normal-text threshold (4.5:1) for foreground readability on a background. */
export function meetsAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}
