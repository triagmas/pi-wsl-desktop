/**
 * RED gate T2a — session index pure logic over an injected FsLike.
 * Projects are keyed by the header `cwd` (authoritative), NOT by the
 * lossy directory-name encoding; collisions and corrupt headers must not
 * crash the index.
 */
import { describe, expect, it } from 'vitest';
import { buildSessionIndex, resolveSessionRoots, decodeBucketCollisionSafe } from '../../src/bridge/sessions';
import type { FsLike } from '../../src/bridge/sessions';

interface FakeFile {
  head?: string;
  tail?: string;
  size?: number;
  mtimeMs?: number;
  error?: string;
}
interface FakeFsShape {
  dirs: Record<string, Array<{ name: string; dir: boolean }>>;
  files: Record<string, FakeFile>;
}

function fakeFs(shape: FakeFsShape): FsLike {
  return {
    async readdir(dir) {
      const d = shape.dirs[dir];
      if (!d) throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' });
      return d.map((e) => ({ name: e.name, isDirectory: () => e.dir, isFile: () => !e.dir }));
    },
    async stat(path) {
      const f = shape.files[path];
      if (!f) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (f.error) throw Object.assign(new Error(f.error), { code: 'EACCES' });
      return { size: f.size ?? (f.head?.length ?? 0), mtimeMs: f.mtimeMs ?? Date.parse('2026-10-19T00:00:00.000Z') };
    },
    async readHead(path, max) {
      const f = shape.files[path];
      if (!f) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (f.error) throw Object.assign(new Error(f.error), { code: 'EACCES' });
      return (f.head ?? '').slice(0, max);
    },
    async readTail(path, max) {
      const f = shape.files[path];
      if (!f) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (f.error) throw Object.assign(new Error(f.error), { code: 'EACCES' });
      const s = f.tail ?? f.head ?? '';
      return s.slice(Math.max(0, s.length - max));
    },
    async readRange(path, offset, length) {
      const f = shape.files[path];
      if (!f) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (f.error) throw Object.assign(new Error(f.error), { code: 'EACCES' });
      const s = f.head ?? '';
      return Buffer.from(s).subarray(offset, offset + length);
    },
  };
}

const ROOT = '/home/u/.pi/agent/sessions';
const hdr = (cwd: string, version = 3, id = 'sess-id') =>
  JSON.stringify({ type: 'session', version, id, timestamp: '2026-10-19T00:00:00.000Z', cwd }) + '\n';

describe('resolveSessionRoots', () => {
  it('prefers PI_CODING_AGENT_SESSION_DIR over settings and default', async () => {
    const fs = fakeFs({ dirs: {}, files: {} });
    const r = await resolveSessionRoots({ fs, env: { PI_CODING_AGENT_SESSION_DIR: '/custom/sessions' }, home: '/home/u' });
    expect(r.roots).toEqual(['/custom/sessions']);
    expect(r.sources['/custom/sessions']).toBe('env');
  });

  it('reads sessionDir from settings.json when env is absent', async () => {
    const fs = fakeFs({
      dirs: {},
      files: { '/home/u/.pi/agent/settings.json': { head: JSON.stringify({ sessionDir: '/from/settings' }) } },
    });
    const r = await resolveSessionRoots({ fs, env: {}, home: '/home/u' });
    expect(r.roots).toEqual(['/from/settings']);
    expect(r.sources['/from/settings']).toBe('settings');
  });

  it('falls back to the default sessions dir with a diagnostic for broken settings', async () => {
    const fs = fakeFs({ dirs: {}, files: { '/home/u/.pi/agent/settings.json': { head: '{broken' } } });
    const r = await resolveSessionRoots({ fs, env: {}, home: '/home/u' });
    expect(r.roots).toEqual(['/home/u/.pi/agent/sessions']);
    expect(r.sources['/home/u/.pi/agent/sessions']).toBe('default');
    expect(r.diagnostics.join(' ')).toMatch(/settings/i);
  });
});

describe('buildSessionIndex', () => {
  const NOW = Date.parse('2026-10-19T12:00:00.000Z');

  it('groups sessions by header cwd across buckets — encoding collisions split into distinct projects', async () => {
    // /a/b-c and /a-b/c both encode to bucket "--a-b-c--" (collision)
    const bucket = `${ROOT}/--a-b-c--`;
    const fs = fakeFs({
      dirs: { [ROOT]: [{ name: '--a-b-c--', dir: true }], [bucket]: [{ name: 'one.jsonl', dir: false }, { name: 'two.jsonl', dir: false }] },
      files: {
        [`${bucket}/one.jsonl`]: { head: hdr('/a/b-c'), size: 100, mtimeMs: Date.parse('2026-10-19T11:00:00.000Z') },
        [`${bucket}/two.jsonl`]: { head: hdr('/a-b/c'), size: 200, mtimeMs: Date.parse('2026-10-19T11:30:00.000Z') },
      },
    });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW });
    expect(idx.projects.map((p) => p.path).sort()).toEqual(['/a-b/c', '/a/b-c']);
    expect(idx.projects.find((p) => p.path === '/a/b-c')?.sessionCount).toBe(1);
    expect(idx.projects.find((p) => p.path === '/a-b/c')?.sessionCount).toBe(1);
  });

  it('merges the same cwd appearing in two different roots', async () => {
    const rootA = '/roots/a';
    const rootB = '/roots/b';
    const fs = fakeFs({
      dirs: {
        [rootA]: [{ name: '--same--', dir: true }],
        [`${rootA}/--same--`]: [{ name: 'x.jsonl', dir: false }],
        [rootB]: [{ name: '--same--', dir: true }],
        [`${rootB}/--same--`]: [{ name: 'y.jsonl', dir: false }],
      },
      files: {
        [`${rootA}/--same--/x.jsonl`]: { head: hdr('/same/cwd'), size: 10, mtimeMs: NOW - 1000 },
        [`${rootB}/--same--/y.jsonl`]: { head: hdr('/same/cwd'), size: 10, mtimeMs: NOW - 5000 },
      },
    });
    const idx = await buildSessionIndex({
      fs,
      env: {},
      home: '/home/u',
      now: NOW,
      rootsOverride: [rootA, rootB],
    });
    expect(idx.projects).toHaveLength(1);
    expect(idx.projects[0].sessionCount).toBe(2);
    expect(idx.projects[0].lastActivityAt).not.toBeNull();
  });

  it('sorts projects by path and sessions by updatedAt desc', async () => {
    const fs = fakeFs({
      dirs: {
        [ROOT]: [{ name: '--zzz--', dir: true }, { name: '--aaa--', dir: true }],
        [`${ROOT}/--zzz--`]: [{ name: 'old.jsonl', dir: false }, { name: 'new.jsonl', dir: false }],
        [`${ROOT}/--aaa--`]: [{ name: 's.jsonl', dir: false }],
      },
      files: {
        [`${ROOT}/--zzz--/old.jsonl`]: { head: hdr('/z/proj'), size: 1, mtimeMs: Date.parse('2026-10-19T09:00:00.000Z') },
        [`${ROOT}/--zzz--/new.jsonl`]: { head: hdr('/z/proj'), size: 1, mtimeMs: Date.parse('2026-10-19T10:00:00.000Z') },
        [`${ROOT}/--aaa--/s.jsonl`]: { head: hdr('/a/proj'), size: 1, mtimeMs: Date.parse('2026-10-19T11:00:00.000Z') },
      },
    });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW });
    expect(idx.projects.map((p) => p.path)).toEqual(['/a/proj', '/z/proj']);
    const zSessions = idx.sessions.filter((s) => s.projectPath === '/z/proj');
    expect(zSessions.map((s) => s.file)).toEqual([
      `${ROOT}/--zzz--/new.jsonl`,
      `${ROOT}/--zzz--/old.jsonl`,
    ]);
  });

  it('flags activeWrite only inside the window', async () => {
    const fs = fakeFs({
      dirs: { [ROOT]: [{ name: '--p--', dir: true }], [`${ROOT}/--p--`]: [{ name: 'a.jsonl', dir: false }, { name: 'b.jsonl', dir: false }] },
      files: {
        [`${ROOT}/--p--/a.jsonl`]: { head: hdr('/p'), size: 1, mtimeMs: NOW - 3_000 },
        [`${ROOT}/--p--/b.jsonl`]: { head: hdr('/p'), size: 1, mtimeMs: NOW - 60_000 },
      },
    });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW, activeWindowMs: 10_000 });
    const byFile = Object.fromEntries(idx.sessions.map((s) => [s.file, s]));
    expect(byFile[`${ROOT}/--p--/a.jsonl`].activeWrite).toBe(true);
    expect(byFile[`${ROOT}/--p--/b.jsonl`].activeWrite).toBe(false);
  });

  it('keeps corrupt/empty/unreadable files as diagnosed sessions, not crashes', async () => {
    const fs = fakeFs({
      dirs: { [ROOT]: [{ name: '--p--', dir: true }], [`${ROOT}/--p--`]: [{ name: 'bad.jsonl', dir: false }, { name: 'zero.jsonl', dir: false }, { name: 'locked.jsonl', dir: false }] },
      files: {
        [`${ROOT}/--p--/bad.jsonl`]: { head: 'not-json\n{"type":"session"...', size: 20, mtimeMs: NOW - 1 },
        [`${ROOT}/--p--/zero.jsonl`]: { head: '', size: 0, mtimeMs: NOW - 2 },
        [`${ROOT}/--p--/locked.jsonl`]: { error: 'EACCES' },
      },
    });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW });
    const byFile = Object.fromEntries(idx.sessions.map((s) => [s.file, s]));
    expect(byFile[`${ROOT}/--p--/bad.jsonl`].availability).toBe('corrupt');
    expect(byFile[`${ROOT}/--p--/zero.jsonl`].availability).toBe('empty');
    expect(byFile[`${ROOT}/--p--/locked.jsonl`].availability).toBe('unreadable');
    // corrupt headers fall back to the bucket dir as an honest project key
    expect(byFile[`${ROOT}/--p--/bad.jsonl`].projectPath).toContain('--p--');
    expect(byFile[`${ROOT}/--p--/bad.jsonl`].diagnostics).toBeTruthy();
  });

  it('survives a missing root and an unreadable bucket with diagnostics', async () => {
    const fs = fakeFs({ dirs: { [ROOT]: [{ name: '--ok--', dir: true }], [`${ROOT}/--ok--`]: [{ name: 's.jsonl', dir: false }] },
      files: { [`${ROOT}/--ok--/s.jsonl`]: { head: hdr('/ok'), size: 1, mtimeMs: NOW - 1 } } });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW, rootsOverride: ['/missing-root', ROOT] });
    expect(idx.projects.map((p) => p.path)).toEqual(['/ok']);
    expect(idx.diagnostics.join(' ')).toMatch(/missing-root/);
  });

  it('extracts session_info display names from the file tail when present', async () => {
    const nameLine = JSON.stringify({ type: 'session_info', id: 'k1', parentId: null, timestamp: 'T', name: 'Refactor auth module' });
    const fs = fakeFs({
      dirs: { [ROOT]: [{ name: '--p--', dir: true }], [`${ROOT}/--p--`]: [{ name: 'named.jsonl', dir: false }, { name: 'plain.jsonl', dir: false }] },
      files: {
        [`${ROOT}/--p--/named.jsonl`]: { head: hdr('/p'), tail: `...\n${nameLine}\n`, size: 100, mtimeMs: NOW - 1 },
        [`${ROOT}/--p--/plain.jsonl`]: { head: hdr('/p'), size: 100, mtimeMs: NOW - 1 },
      },
    });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW });
    const byFile = Object.fromEntries(idx.sessions.map((s) => [s.file, s]));
    expect(byFile[`${ROOT}/--p--/named.jsonl`].name).toBe('Refactor auth module');
    expect(byFile[`${ROOT}/--p--/plain.jsonl`].name).toBeNull();
  });

  it('skips non-jsonl files and nested sub-session directories (internal transcripts)', async () => {
    const fs = fakeFs({
      dirs: {
        [ROOT]: [{ name: '--p--', dir: true }],
        [`${ROOT}/--p--`]: [
          { name: 's.jsonl', dir: false },
          { name: 'notes.txt', dir: false },
          { name: 'subagent-artifacts', dir: true },
        ],
      },
      files: { [`${ROOT}/--p--/s.jsonl`]: { head: hdr('/p'), size: 1, mtimeMs: NOW - 1 } },
    });
    const idx = await buildSessionIndex({ fs, env: {}, home: '/home/u', now: NOW });
    expect(idx.sessions).toHaveLength(1);
    expect(idx.sessions[0].file).toMatch(/s\.jsonl$/);
  });

  it('decodeBucketCollisionSafe is pure and does not guess across dashes', () => {
    // Documents the fallback policy: full path reconstruction from an
    // encoded bucket name is LOSSY — callers must not use it to invent paths.
    expect(decodeBucketCollisionSafe('--a-b-c--')).toBeNull();
  });
});
