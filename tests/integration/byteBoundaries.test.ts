/**
 * Review round 3 (Issue #1) — multibyte UTF-8 must survive chunked reads:
 * when a 64-KiB chunk boundary lands INSIDE a multibyte character the reader
 * and the content search must neither lose bytes nor drift their offsets.
 * RED first: the old string-based readRange corrupts the straddling char
 * (U+FFFD) and re-encodes it into a different byte length → offset drift.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readSessionFile } from '../../src/bridge/sessionReader';
import { searchSessions } from '../../src/bridge/search';
import { nodeFs, type SessionIndex } from '../../src/bridge/sessions';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'piwsd-bytes-'));
const F = (name: string): string => path.join(tmp, name);

const hdr = `${JSON.stringify({ type: 'session', version: 3, id: 'h', timestamp: 'T', cwd: '/p' })}\n`;
const msg = (id: string, parent: string | null, text: string): string =>
  `${JSON.stringify({ type: 'message', id, parentId: parent, timestamp: 'T', message: { role: 'user', content: text, timestamp: 1 } })}\n`;

// Reader file: unicode payloads that straddle boundaries at chunkBytes=16.
const unicodeBody = 'привет 🚀 日本語 mixed';
const readerFile = F('unicode.jsonl');
writeFileSync(readerFile, hdr + msg('a', null, unicodeBody) + msg('b', 'a', 'хвост 🎉') + msg('c', 'b', 'конец'));

// Search file: the 64-KiB chunk boundary lands INSIDE the first multibyte
// character of the marker line («п» = d0 bf at bytes 65535..65536), so the old
// string-decoding reader corrupts the query word and the new byte-faithful
// reader must still find it at its true line number.
const searchFile = F('boundary-search.jsonl');
const prefix = 'ранний привет!\n'; // line 1, ODD byte length (27) so the padding stays even
const padBytes = 65535 - Buffer.byteLength(prefix); // padding ends at byte 65534
if (padBytes % 2 !== 0) throw new Error(`pad arithmetic broken: padBytes=${padBytes}`);
const padding = 'p\n'.repeat(padBytes / 2); // even length → complete lines only
const padLineCount = padBytes / 2;
const markerLineNo = 1 + padLineCount + 1; // prefix line + padding lines + marker
const markerLine = 'привет за границей чанка'; // «п» straddles byte 65536
writeFileSync(searchFile, prefix + padding + markerLine + '\n');

afterAll(() => {
  /* tmp files are disposable */
});

describe('byte-exact chunked reads across multibyte UTF-8 boundaries', () => {
  it('readSessionFile keeps every entry intact with tiny chunkBytes (straddling 🚀/кириллица)', async () => {
    const r = await readSessionFile({ fs: nodeFs, file: readerFile, chunkBytes: 16 });
    expect(r.diagnostics).toEqual([]);
    expect(r.availability).toBe('ok');
    expect(r.entries.map((e) => (e.raw as { message?: { content?: string } }).message?.content)).toEqual([
      unicodeBody,
      'хвост 🎉',
      'конец',
    ]);
    expect(r.leafId).toBe('c');
  });

  it('searchSessions finds a match positioned AFTER a straddling 64-KiB boundary', async () => {
    const index: SessionIndex = {
      projects: [],
      diagnostics: [],
      sessions: [
        {
          id: 'sess-1',
          file: searchFile,
          root: '/sessions',
          projectId: '/p',
          projectPath: '/p',
          name: null,
          createdAt: null,
          updatedAt: '2026-10-19T00:00:00.000Z',
          sizeBytes: 0,
          version: 3,
          availability: 'ok',
          activeWrite: false,
          diagnostics: null,
        },
      ],
    };
    const res = await searchSessions({ fs: nodeFs, index, query: 'привет', includeContent: true });
    const lines = res.matches.filter((m) => m.field === 'content').map((m) => m.line);
    expect(lines).toContain(1); // the early intact occurrence
    expect(lines).toContain(markerLineNo); // the one BEHIND the 64-KiB boundary
  });
});
