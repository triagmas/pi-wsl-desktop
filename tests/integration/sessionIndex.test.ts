/**
 * T2b — session index over REAL files (nodeFs): layout fidelity, permission
 * failures, no writes to the indexed files.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSessionIndex, nodeFs, resolveSessionRoots } from '../../src/bridge/sessions';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'piwsd-idx-'));
const ROOT = path.posix.join(tmp.replace(/\\/g, '/'), 'sessions');

function header(cwd: string, id: string): string {
  return `${JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-19T01:00:00.000Z', cwd })}\n`;
}
function sha(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

// Real two-cwd collision bucket + extras
mkdirSync(path.join(ROOT, '--a-b-c--'), { recursive: true });
writeFileSync(path.join(ROOT, '--a-b-c--', 'one.jsonl'), header('/a/b-c', 'id-one') + '{"type":"message","id":"m1","parentId":null,"timestamp":"T","message":{"role":"user","content":"hi","timestamp":1}}\n');
writeFileSync(path.join(ROOT, '--a-b-c--', 'two.jsonl'), header('/a-b/c', 'id-two') + '{"type":"session_info","id":"k1","parentId":"m0","timestamp":"T","name":"Named session"}\n');
writeFileSync(path.join(ROOT, '--a-b-c--', 'notes.txt'), 'ignore me\n');
mkdirSync(path.join(ROOT, '--a-b-c--', 'subagent-artifacts'), { recursive: true });
writeFileSync(path.join(ROOT, '--a-b-c--', 'subagent-artifacts', 'internal.jsonl'), header('/internal', 'internal') + '\n');
writeFileSync(path.join(ROOT, '--a-b-c--', 'empty.jsonl'), '');
writeFileSync(path.join(ROOT, '--a-b-c--', 'bad.jsonl'), 'this is not json\n');
mkdirSync(path.join(ROOT, '--locked--'), { recursive: true });
writeFileSync(path.join(ROOT, '--locked--', 'hidden.jsonl'), header('/locked', 'id-locked') + '\n');
chmodSync(path.join(ROOT, '--locked--'), 0o000);

afterAll(() => {
  try {
    chmodSync(path.join(ROOT, '--locked--'), 0o755);
  } catch {
    /* best effort */
  }
});

const NOW = Date.parse('2026-10-19T12:00:00.000Z');

describe('buildSessionIndex (real files)', () => {
  it('indexes real JSONL files by header cwd, skips nested transcripts and non-jsonl', async () => {
    const before = sha(path.join(ROOT, '--a-b-c--', 'one.jsonl'));
    const mtimeBefore = statSync(path.join(ROOT, '--a-b-c--', 'one.jsonl')).mtimeMs;
    const idx = await buildSessionIndex({ fs: nodeFs, env: { PI_CODING_AGENT_SESSION_DIR: ROOT }, home: tmp, now: NOW });
    // header cwd wins over lossy bucket name; the corrupt file surfaces as an
    // honest bucket-dir project instead of hiding or inventing a cwd
    const paths = idx.projects.map((p) => p.path).sort();
    expect(paths).toHaveLength(3);
    expect(paths.filter((p) => p.startsWith('/a'))).toEqual(['/a-b/c', '/a/b-c']);
    expect(paths.find((p) => p.includes('--a-b-c--'))).toBeTruthy();
    const files = idx.sessions.map((s) => path.posix.basename(s.file)).sort();
    expect(files).toEqual(['bad.jsonl', 'empty.jsonl', 'one.jsonl', 'two.jsonl']); // no notes.txt, no nested internal.jsonl, locked dir unreadable
    // no writes during indexing (hash + mtime identical)
    expect(sha(path.join(ROOT, '--a-b-c--', 'one.jsonl'))).toBe(before);
    expect(statSync(path.join(ROOT, '--a-b-c--', 'one.jsonl')).mtimeMs).toBe(mtimeBefore);
  });

  it('classifies empty/corrupt files and reads display names', async () => {
    const idx = await buildSessionIndex({ fs: nodeFs, env: { PI_CODING_AGENT_SESSION_DIR: ROOT }, home: tmp, now: NOW });
    const by = Object.fromEntries(idx.sessions.map((s) => [path.posix.basename(s.file), s]));
    expect(by['empty.jsonl'].availability).toBe('empty');
    expect(by['bad.jsonl'].availability).toBe('corrupt');
    expect(by['bad.jsonl'].diagnostics).toMatch(/json|header/i);
    expect(by['two.jsonl'].name).toBe('Named session');
    expect(by['one.jsonl'].name).toBeNull();
    expect(by['one.jsonl'].id).toBe('id-one');
    // corrupt file falls back to the bucket dir as project key (no path guessing)
    expect(by['bad.jsonl'].projectPath).toContain('--a-b-c--');
  });

  it('reports an unreadable bucket via diagnostics without crashing', async () => {
    const idx = await buildSessionIndex({ fs: nodeFs, env: { PI_CODING_AGENT_SESSION_DIR: ROOT }, home: tmp, now: NOW });
    expect(idx.sessions.map((s) => s.file).join(' ')).not.toContain('hidden.jsonl');
    expect(idx.diagnostics.join(' ')).toMatch(/--locked--/);
  });

  it('resolveSessionRoots: env > settings > default over real files', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-home-'));
    mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ sessionDir: '/from/settings' }));
    const envSel = await resolveSessionRoots({ fs: nodeFs, env: { PI_CODING_AGENT_SESSION_DIR: '/from/env' }, home });
    expect(envSel.roots).toEqual(['/from/env']);
    const setSel = await resolveSessionRoots({ fs: nodeFs, env: {}, home });
    expect(setSel.roots).toEqual(['/from/settings']);
    const defSel = await resolveSessionRoots({ fs: nodeFs, env: {}, home: mkdtempSync(path.join(os.tmpdir(), 'piwsd-empty-')) });
    expect(defSel.roots[0]).toMatch(/\.pi\/agent\/sessions$/);
    expect(defSel.sources[defSel.roots[0]]).toBe('default');
  });

  it('a broken settings.json produces a diagnostic and falls back to default', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-badhome-'));
    mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), '{not json');
    const r = await resolveSessionRoots({ fs: nodeFs, env: {}, home });
    expect(r.roots[0]).toMatch(/\.pi\/agent\/sessions$/);
    expect(r.diagnostics.join(' ')).toMatch(/settings/i);
  });
});
