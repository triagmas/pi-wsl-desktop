/**
 * Review round 4 seam test — HistoryView's page accumulation
 * (`mergeHistoryPage`, the exact pure function the view uses) against the
 * REAL sessionReader over a REAL tmp file with more than PAGE (100) entries:
 * the initial page must be the EARLIEST entries and each continuation must
 * APPEND later entries in strict chronological order (the reader cursor is
 * strictly forward). RED first: the old view prepended continuation pages
 * and labelled the button «Показать ранее», mixing chronology.
 * (DOM-side button/label behaviour is covered by the flipped RTL test in
 * tests/ui/m1Sessions.test.tsx; this file pins the reader↔view seam itself.)
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSessionFile } from '../../src/bridge/sessionReader';
import { nodeFs } from '../../src/bridge/sessions';
import { mergeHistoryPage } from '../../src/renderer/historyMerge';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'piwsd-hist-'));
const FILE = path.join(tmp, 'long.jsonl');
const TOTAL = 120;

const header = `${JSON.stringify({ type: 'session', version: 3, id: 's1', timestamp: 'T', cwd: '/proj' })}\n`;
const rows = Array.from({ length: TOTAL }, (_, i) =>
  JSON.stringify({
    type: 'message',
    id: `m${i}`,
    parentId: i === 0 ? null : `m${i - 1}`,
    timestamp: 'T',
    message: { role: 'user', content: `msg-${i}`, timestamp: i + 1 },
  }),
).join('\n');
writeFileSync(FILE, header + rows + '\n');

describe('HistoryView merge × real sessionReader pagination seam', () => {
  it('keeps strict chronological order across continuations of a >PAGE session', async () => {
    const page1 = await readSessionFile({ fs: nodeFs, file: FILE, limit: 100 });
    expect(page1.truncated).toBe(true);
    expect(page1.nextCursor).toBe('m99');
    expect(page1.entries).toHaveLength(100);
    expect(page1.entries[0]?.id).toBe('m0');

    const page2 = await readSessionFile({ fs: nodeFs, file: FILE, sinceEntryId: page1.nextCursor as string, limit: 100 });
    expect(page2.truncated).toBe(false);
    expect(page2.entries).toHaveLength(20);
    expect(page2.entries[0]?.id).toBe('m100');

    // the exact accumulation the view performs
    const merged = mergeHistoryPage(page1, page2, page1.nextCursor ?? undefined);
    expect(merged.entries).toHaveLength(TOTAL);
    const ids = merged.entries.map((e) => e.id);
    expect(ids[0]).toBe('m0');
    expect(ids[99]).toBe('m99');
    expect(ids[100]).toBe('m100');
    expect(ids[TOTAL - 1]).toBe('m119');
    // flags of the LATEST page win: nothing left to load (the view gates the
    // button on `truncated`, so a parity cursor on the final page is inert)
    expect(merged.truncated).toBe(false);
    expect(merged.nextCursor).toBe('m119');
  });

  it('first load replaces state instead of merging (no since cursor)', async () => {
    const page1 = await readSessionFile({ fs: nodeFs, file: FILE, limit: 100 });
    const fresh = mergeHistoryPage(page1, page1, undefined);
    expect(fresh.entries).toHaveLength(100);
    expect(fresh.entries[0]?.id).toBe('m0');
  });
});
