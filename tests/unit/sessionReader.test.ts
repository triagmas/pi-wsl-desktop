/**
 * RED gate T3 — read-only session reader.
 *
 * Guarantees under test:
 * - bounded, chunked, LF-only parsing with per-line diagnostics (corrupt
 *   lines skipped, never fatal);
 * - partial trailing line (concurrent append) reported, never misparsed;
 * - tree semantics: parentId chain, active-leaf selection, active branch;
 * - cursor pagination (sinceEntryId + limit + truncated);
 * - legacy v1 linear files (missing parentId) chain correctly;
 * - unknown future entry types survive as opaque raw records;
 * - entry/byte caps bound memory (fail with diagnostics, not OOM);
 * - the reader NEVER writes (proved in integration via hash+mtime).
 */
import { describe, expect, it } from 'vitest';
import { readSessionFile, computeActiveLeaf, activeBranchPath } from '../../src/bridge/sessionReader';
import type { FsLike, DirEntry, FileMeta } from '../../src/bridge/sessions';

function filesFs(files: Record<string, string>): FsLike {
  const fs: FsLike = {
    async readdir(_dir: string): Promise<DirEntry[]> {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    async stat(p: string): Promise<FileMeta> {
      const c = files[p];
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { size: Buffer.byteLength(c), mtimeMs: 1_700_000_000_000 };
    },
    async readHead(p, max) {
      const c = files[p];
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return Buffer.from(c).subarray(0, max).toString('utf8');
    },
    async readTail(p, max) {
      const c = files[p];
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      const b = Buffer.from(c);
      return b.subarray(Math.max(0, b.length - max)).toString('utf8');
    },
    async readRange(p, offset, length) {
      const c = files[p];
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return Buffer.from(c).subarray(offset, offset + length).toString('utf8');
    },
  };
  return fs;
}

const FILE = '/s/one.jsonl';
const hdr = (version = 3) =>
  `${JSON.stringify({ type: 'session', version, id: 'h1', timestamp: '2026-10-19T00:00:00.000Z', cwd: '/p' })}\n`;
const msg = (id: string, parentId: string | null, role = 'user', content = 'hi') =>
  `${JSON.stringify({ type: 'message', id, parentId, timestamp: 'T', message: { role, content, timestamp: 1 } })}\n`;

const CHAIN = hdr(3) + msg('a', null) + msg('b', 'a', 'assistant') + msg('c', 'b') + msg('d', 'b', 'assistant');

describe('readSessionFile — structure', () => {
  it('parses header, entries and derives the active leaf (entry that nobody points to)', async () => {
    const r = await readSessionFile({ fs: filesFs({ [FILE]: CHAIN }), file: FILE });
    expect(r.availability).toBe('ok');
    expect(r.header?.version).toBe(3);
    expect(r.header?.cwd).toBe('/p');
    expect(r.entries.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    // c and d are leaves; append-order-last wins as the active leaf
    expect(r.leafId).toBe('d');
    expect(r.partialTrailing).toBe(false);
    expect(r.diagnostics).toEqual([]);
  });

  it('returns an active-branch-only view when branch=active (root→leaf order)', async () => {
    const r = await readSessionFile({ fs: filesFs({ [FILE]: CHAIN }), file: FILE, branch: 'active' });
    expect(r.entries.map((e) => e.id)).toEqual(['a', 'b', 'd']);
  });

  it('chains legacy v1 entries that have no parentId fields', async () => {
    const v1 =
      hdr(1) +
      `${JSON.stringify({ type: 'message', id: 'x1', timestamp: 'T', message: { role: 'user', content: 'old' } })}\n` +
      `${JSON.stringify({ type: 'message', id: 'x2', timestamp: 'T', message: { role: 'assistant', content: 'ok' } })}\n`;
    const r = await readSessionFile({ fs: filesFs({ [FILE]: v1 }), file: FILE });
    expect(r.header?.version).toBe(1);
    expect(r.entries.map((e) => e.id)).toEqual(['x1', 'x2']);
    expect(r.entries[1].parentId).toBe('x1'); // linear chain reconstructed
    expect(r.leafId).toBe('x2');
  });

  it('passes unknown future entry types through as opaque raw records', async () => {
    const body = hdr(3) + `${JSON.stringify({ type: 'quantum_entry', id: 'q1', parentId: null, payload: 42 })}\n`;
    const r = await readSessionFile({ fs: filesFs({ [FILE]: body }), file: FILE });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].type).toBe('quantum_entry');
    expect(r.entries[0].raw).toEqual({ type: 'quantum_entry', id: 'q1', parentId: null, payload: 42 });
    expect(r.availability).toBe('ok');
  });
});

describe('readSessionFile — resilience', () => {
  it('reports a partial trailing line without parsing it (concurrent append in progress)', async () => {
    const body = hdr(3) + msg('a', null) + '{"type":"message","id":"partial';
    const r = await readSessionFile({ fs: filesFs({ [FILE]: body }), file: FILE });
    expect(r.partialTrailing).toBe(true);
    expect(r.entries.map((e) => e.id)).toEqual(['a']);
    expect(r.availability).toBe('ok');
  });

  it('skips corrupt lines with numbered diagnostics and keeps valid ones', async () => {
    const body = hdr(3) + msg('a', null) + 'not-json\n' + '{}\n' + msg('b', 'a');
    const r = await readSessionFile({ fs: filesFs({ [FILE]: body }), file: FILE });
    expect(r.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.availability).toBe('ok');
    expect(r.diagnostics).toEqual([
      { line: 3, error: expect.stringContaining('json') },
      { line: 4, error: expect.stringContaining('type') },
    ]);
  });

  it('marks unreadable/empty/correctly-typed-bad-header files', async () => {
    const empty = await readSessionFile({ fs: filesFs({ [FILE]: '' }), file: FILE });
    expect(empty.availability).toBe('empty');

    const badHeader = await readSessionFile({ fs: filesFs({ [FILE]: 'garbage\n' + msg('a', null) }), file: FILE });
    expect(badHeader.availability).toBe('corrupt');
    expect(badHeader.header).toBeNull();
    expect(badHeader.entries).toHaveLength(1); // best-effort body parse

    const futureVersion = await readSessionFile({
      fs: filesFs({ [FILE]: hdr(4) + msg('a', null) }),
      file: FILE,
    });
    expect(futureVersion.availability).toBe('corrupt');
    expect(futureVersion.header).toBeNull();

    const missing = await readSessionFile({ fs: filesFs({}), file: '/nope.jsonl' });
    expect(missing.availability).toBe('unreadable');
  });

  it('skips an oversize line (byte cap) with a diagnostic instead of buffering it', async () => {
    const huge = 'x'.repeat(2048);
    const body = hdr(3) + msg('a', null) + `${JSON.stringify({ type: 'message', id: 'big', raw: huge })}\n` + msg('b', 'a');
    const r = await readSessionFile({ fs: filesFs({ [FILE]: body }), file: FILE, maxLineBytes: 512 });
    expect(r.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.diagnostics.some((d) => /exceeds/i.test(d.error))).toBe(true);
  });

  it('bounds total bytes read (prefix) and reports truncation', async () => {
    let body = hdr(3);
    for (let i = 0; i < 200; i += 1) body += msg(`m${i}`, i === 0 ? null : `m${i - 1}`);
    const r = await readSessionFile({ fs: filesFs({ [FILE]: body }), file: FILE, maxBytesTotal: 2048 });
    expect(r.truncated).toBe(true);
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.entries.length).toBeLessThan(200);
  });

  it('caps entry collection with a diagnostic (memory bound)', async () => {
    let body = hdr(3);
    for (let i = 0; i < 50; i += 1) body += msg(`m${i}`, i === 0 ? null : `m${i - 1}`);
    const r = await readSessionFile({ fs: filesFs({ [FILE]: body }), file: FILE, maxEntries: 10 });
    expect(r.entries).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(r.diagnostics.some((d) => /entry cap/i.test(d.error))).toBe(true);
  });
});

describe('readSessionFile — cursor pagination', () => {
  it('returns entries strictly after sinceEntryId with nextCursor and truncated', async () => {
    const r1 = await readSessionFile({ fs: filesFs({ [FILE]: CHAIN }), file: FILE, limit: 2 });
    expect(r1.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r1.truncated).toBe(true);
    expect(r1.nextCursor).toBe('b');

    const r2 = await readSessionFile({ fs: filesFs({ [FILE]: CHAIN }), file: FILE, sinceEntryId: 'b', limit: 2 });
    expect(r2.entries.map((e) => e.id)).toEqual(['c', 'd']);
    expect(r2.truncated).toBe(false);
    expect(r2.nextCursor).toBe('d');

    const r3 = await readSessionFile({ fs: filesFs({ [FILE]: CHAIN }), file: FILE, sinceEntryId: 'd', limit: 2 });
    expect(r3.entries).toEqual([]);
    expect(r3.nextCursor).toBeNull();
  });

  it('an unknown cursor yields an explicit diagnostic and no entries (never a silent full dump)', async () => {
    const r = await readSessionFile({ fs: filesFs({ [FILE]: CHAIN }), file: FILE, sinceEntryId: 'zzz' });
    expect(r.entries).toEqual([]);
    expect(r.diagnostics.some((d) => /cursor/i.test(d.error))).toBe(true);
  });
});

describe('tree helpers (pure)', () => {
  const rows = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'd', parentId: 'b' },
  ];
  it('computeActiveLeaf picks append-order-last among leaves', () => {
    expect(computeActiveLeaf(rows)).toBe('d');
    expect(computeActiveLeaf([])).toBeNull();
  });
  it('activeBranchPath walks leaf→root and returns root→leaf order', () => {
    expect(activeBranchPath(rows, 'd')).toEqual(['a', 'b', 'd']);
    // broken parent chain terminates safely at the known root of the walk
    expect(activeBranchPath(rows, 'ghost')).toEqual(['ghost']);
  });
});
