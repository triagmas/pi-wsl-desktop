/**
 * UI21 F4 — composer layout contract (P2 overlap: long model label ∩ send button).
 *
 * The defect was not cosmetic: `.dl-send` is absolutely positioned at the
 * etalon coordinates (right 16px, bottom 13px, 54×52) *inside* the composer,
 * while `.dl-composer-row2` (model + thinking chips) used the full composer
 * width. With a long real label — a provider/model signature
 * (438 px chip) — the thinking chip slid under the send button and became
 * partly unclickable at 1280/1024 with the details panel open.
 *
 * Fix is structural, not cosmetic: the chips row reserves the send footprint
 * (so nothing can enter that zone for any label length) and the chips are
 * shrinkable with an ellipsis label (so a long name truncates instead of
 * pushing controls out). No `overflow: hidden` masking is used anywhere.
 *
 * These assertions fail on the pre-fix stylesheet and pass after it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const designDir = path.join(__dirname, '..', '..', 'src', 'renderer', 'design');
const componentsPath = path.join(designDir, 'components.css');
const boardPath = path.join(designDir, 'board.css');
// Исходник читаем без комментариев: `}` внутри пояснения иначе обрывает тело правила.
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(readFileSync(componentsPath, 'utf8'));
const boardCss = strip(readFileSync(boardPath, 'utf8'));

/** Extract the declarations of the first rule whose selector matches exactly. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

function decl(body: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`, 'm').exec(body);
  return match ? match[1].trim() : null;
}

const px = (value: string | null): number => (value ? Number.parseFloat(value) : Number.NaN);

/**
 * Resolve a `calc()` of px terms to a number. Ревью P2: проверять надо
 * вычисленный резерв, а не написание — `calc(54px - 16px)` тоже «содержит 54px».
 */
function calcPx(value: string | null, fallbackLabel: string): number {
  if (!value) throw new Error(`missing value: ${fallbackLabel}`);
  const inner = /^calc\((.*)\)$/.exec(value.trim());
  if (!inner) return px(value);
  const normalized = inner[1].replace(/\s+/g, '');
  const terms = normalized.match(/[+-]?\d+(?:\.\d+)?px/g);
  if (!terms || terms.join('') !== normalized) throw new Error(`unsupported calc: ${value}`);
  return terms.reduce((sum, term) => sum + Number.parseFloat(term), 0);
}

const send = ruleBody(css, '.dl-send');
const row2 = ruleBody(css, '.dl-composer-row2');

describe('composer row: send-button footprint', () => {
  it('send button keeps the etalon geometry (absolute, 54px, right 16px)', () => {
    expect(decl(send, 'position')).toBe('absolute');
    expect(px(decl(send, 'width'))).toBe(54);
    expect(px(decl(send, 'right'))).toBe(16);
  });

  it('chips row reserves the whole send footprint, so no label can slide under it', () => {
    const padding = decl(row2, 'padding-right');
    expect(padding, 'row2 must reserve space for the absolutely positioned send button').not.toBeNull();
    const reserved = calcPx(padding, 'row2 padding-right');
    // Кнопка (54) + её правый отступ (16) обязаны быть исключены из ряда чипов.
    expect(reserved).toBeGreaterThanOrEqual(54 + 16);
    // И ровно тот же резерв, что в утверждённом Lab-композере: одно значение, один источник.
    const labRow = ruleBody(boardCss, '.dl-board-composer-box .dl-composer-row2');
    expect(reserved).toBe(calcPx(decl(labRow, 'padding-right'), 'board composer row2 padding-right'));
  });

  it('chips are shrinkable and their label ellipsizes instead of pushing controls', () => {
    const rowChip = ruleBody(css, '.dl-composer-row2 .dl-chip');
    expect(decl(rowChip, 'flex')).toMatch(/^0 1 auto/);
    expect(decl(rowChip, 'min-width')).toBe('0');
    const thinking = ruleBody(css, '.dl-composer-row2 .dl-chip-thinking');
    // Thinking-чип короткий и фиксированный — он не должен усекаться вместе с моделью.
    expect(decl(thinking, 'flex')).toMatch(/^0 0 auto/);
    const label = ruleBody(css, '.dl-chip-label');
    expect(decl(label, 'text-overflow')).toBe('ellipsis');
    expect(decl(label, 'min-width')).toBe('0');
  });
});

describe('composer row: no clipping workaround', () => {
  it('does not hide overflow on the composer or the chips row', () => {
    const composerRule = ruleBody(css, '.dl-composer');
    for (const body of [composerRule, row2]) {
      expect(decl(body, 'overflow')).toBeNull();
      expect(decl(body, 'overflow-x')).toBeNull();
      expect(decl(body, 'overflow-y')).toBeNull();
    }
  });
});
