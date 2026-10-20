/**
 * Review P2#1 (owner disposition: fix in PR #6, TDD) — mergeHistoryPage must
 * keep the parse diagnostics of EVERY loaded page when appending
 * continuation pages, deduped and bounded. RED first: the old merge took
 * `diagnostics` from the LAST page only, silently dropping earlier pages'
 * corrupt-line reports from the UI after «Загрузить продолжение».
 */
import { describe, expect, it } from 'vitest';
import { mergeHistoryPage } from '../../src/renderer/historyMerge';
import {
  MAX_READ_DIAGNOSTICS,
  type ReadDiagnosticT,
  type ReadSessionResultT,
  type SessionEntryT,
} from '../../src/shared/m1Protocol';

const d = (line: number, error: string): ReadDiagnosticT => ({ line, error });

const entry = (id: string): SessionEntryT =>
  ({ type: 'message', id, parentId: null, timestamp: 'T', raw: { type: 'message', id } }) as SessionEntryT;

const page = (
  ids: string[],
  diagnostics: ReadDiagnosticT[],
  opts: { truncated?: boolean; cursor?: string | null } = {},
): ReadSessionResultT => ({
  header: null,
  entries: ids.map(entry),
  leafId: ids[ids.length - 1] ?? null,
  nextCursor: opts.cursor ?? null,
  truncated: opts.truncated ?? false,
  partialTrailing: false,
  diagnostics,
  availability: 'ok',
});

describe('mergeHistoryPage — diagnostics across pages (P2#1)', () => {
  it('keeps diagnostics of BOTH pages, earliest-first, when appending', () => {
    const prev = page(['m0'], [d(2, 'invalid json: unexpected token')], { truncated: true, cursor: 'm0' });
    const next = page(['m1'], [d(7, 'entry is not an object with a type')], { cursor: 'm1' });
    const merged = mergeHistoryPage(prev, next, 'm0');
    expect(merged.entries.map((e) => e.id)).toEqual(['m0', 'm1']); // append order unchanged
    expect(merged.diagnostics).toEqual([d(2, 'invalid json: unexpected token'), d(7, 'entry is not an object with a type')]);
  });

  it('dedupes identical diagnostics repeated across pages', () => {
    const prev = page(['m0'], [d(2, 'invalid json')], { truncated: true, cursor: 'm0' });
    const next = page(['m1'], [d(2, 'invalid json'), d(8, 'missing entry type')], { cursor: 'm1' });
    const merged = mergeHistoryPage(prev, next, 'm0');
    expect(merged.diagnostics).toEqual([d(2, 'invalid json'), d(8, 'missing entry type')]);
  });

  it('bounds the merged diagnostics at MAX_READ_DIAGNOSTICS (earliest pages win)', () => {
    const prev = page(
      ['m0'],
      Array.from({ length: MAX_READ_DIAGNOSTICS }, (_, i) => d(i + 1, `page1 err ${i + 1}`)),
      { truncated: true, cursor: 'm0' },
    );
    const next = page(
      ['m1'],
      Array.from({ length: MAX_READ_DIAGNOSTICS }, (_, i) => d(MAX_READ_DIAGNOSTICS + i + 1, `page2 err ${i}`)),
      { cursor: 'm1' },
    );
    const merged = mergeHistoryPage(prev, next, 'm0');
    expect(merged.diagnostics).toHaveLength(MAX_READ_DIAGNOSTICS);
    expect(merged.diagnostics[0]).toEqual(d(1, 'page1 err 1'));
    expect(merged.diagnostics.some((x) => x.line === MAX_READ_DIAGNOSTICS + 1)).toBe(false); // earliest-first cut
  });

  it('first load (no since cursor) returns the fresh page untouched', () => {
    const prev = page(['m0'], [d(2, 'x')], { truncated: true, cursor: 'm0' });
    const next = page(['m1'], [d(9, 'y')], { cursor: 'm1' });
    expect(mergeHistoryPage(prev, next, undefined)).toBe(next);
  });
});
