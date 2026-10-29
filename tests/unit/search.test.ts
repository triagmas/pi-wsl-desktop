/**
 * RED gate T4 — searchSessions.
 * Metadata search is the default; content search requires the EXPLICIT
 * includeContent flag (SPEC §4.1) and is bounded.
 */
import { describe, expect, it } from 'vitest';
import { searchSessions } from '../../src/bridge/search';
import type { SessionIndex } from '../../src/bridge/sessions';
import type { FsLike, DirEntry, FileMeta } from '../../src/bridge/sessions';

function filesFs(files: Record<string, string>): FsLike {
  const noop = async (): Promise<DirEntry[]> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  return {
    readdir: noop,
    async stat(p) {
      const c = files[p];
      if (c === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: Buffer.byteLength(c), mtimeMs: 1 } as FileMeta;
    },
    async readHead(p, max) {
      const c = files[p] ?? '';
      return Buffer.from(c).subarray(0, max).toString('utf8');
    },
    async readTail(p, max) {
      const c = files[p] ?? '';
      const b = Buffer.from(c);
      return b.subarray(Math.max(0, b.length - max)).toString('utf8');
    },
    async readRange(p, offset, length) {
      const c = files[p] ?? '';
      return Buffer.from(c).subarray(offset, offset + length);
    },
  };
}

const SESSION = (over: Partial<SessionIndex['sessions'][number]> = {}): SessionIndex['sessions'][number] => ({
  id: 's1',
  file: '/roots/--proj--/s1.jsonl',
  root: '/roots',
  projectId: '/home/u/alpha-repo',
  projectPath: '/home/u/alpha-repo',
  name: 'Fix auth bug',
  // UI26 R01: derived title fields are part of the indexed session contract.
  displayName: 'Fix auth bug',
  displayNameSource: 'pi',
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T01:00:00.000Z',
  sizeBytes: 10,
  version: 3,
  availability: 'ok',
  activeWrite: false,
  diagnostics: null,
  ...over,
});

const INDEX: SessionIndex = {
  projects: [],
  sessions: [
    SESSION(),
    SESSION({
      id: 's2',
      file: '/roots/--other--/s2.jsonl',
      projectId: '/home/u/beta',
      projectPath: '/home/u/beta',
      name: 'Docs cleanup',
      availability: 'ok',
    }),
    SESSION({
      id: 's3',
      file: '/roots/--broken--/s3.jsonl',
      projectId: '/home/u/beta',
      projectPath: '/home/u/beta',
      name: null,
      availability: 'corrupt',
      diagnostics: 'bad header',
    }),
  ],
  diagnostics: [],
};

const SECRET_BODY = 'line1\nthe quick brown fox jumps\nline3\n';

describe('searchSessions', () => {
  it('matches metadata (name and cwd) by default — content stays untouched', async () => {
    const fs = filesFs({ '/roots/--proj--/s1.jsonl': SECRET_BODY });
    const byName = await searchSessions({ fs, index: INDEX, query: 'auth' });
    expect(byName.matches).toEqual([
      expect.objectContaining({ sessionId: 's1', field: 'name', snippet: 'Fix auth bug' }),
    ]);
    const byCwd = await searchSessions({ fs, index: INDEX, query: 'alpha' });
    expect(byCwd.matches.map((m) => m.field)).toContain('cwd');
    // WITHOUT includeContent the body token must never match:
    const content = await searchSessions({ fs, index: INDEX, query: 'brown fox' });
    expect(content.matches).toEqual([]);
  });

  it('content search works only with the explicit flag and reports line+snippet', async () => {
    const fs = filesFs({ '/roots/--proj--/s1.jsonl': SECRET_BODY });
    const r = await searchSessions({ fs, index: INDEX, query: 'brown fox', includeContent: true });
    expect(r.matches).toEqual([
      expect.objectContaining({ sessionId: 's1', field: 'content', line: 2, snippet: expect.stringContaining('brown fox') }),
    ]);
    expect(r.truncated).toBe(false);
  });

  it('filters by projectId and skips unreadable/corrupt bodies in content mode', async () => {
    const fs = filesFs({ '/roots/--proj--/s1.jsonl': SECRET_BODY });
    const scoped = await searchSessions({ fs, index: INDEX, query: 'auth', projectId: '/home/u/beta' });
    expect(scoped.matches).toEqual([]);
    // corrupt session: metadata still searchable, content attempt yields nothing (no crash)
    const corrupt = await searchSessions({ fs, index: INDEX, query: 'bad header', includeContent: true });
    expect(corrupt.matches.every((m) => m.field !== 'content')).toBe(true);
  });

  it('is case-insensitive and bounds the match count (truncated flag)', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `needle ${i}`).join('\n');
    const fs = filesFs({ '/roots/--proj--/s1.jsonl': many });
    const r = await searchSessions({ fs, index: INDEX, query: 'needle', includeContent: true, maxMatches: 5 });
    expect(r.matches).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });
});
