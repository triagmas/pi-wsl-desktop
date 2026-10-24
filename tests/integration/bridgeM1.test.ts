/**
 * T6b — M1 surface over a REAL bridge subprocess (NDJSON end-to-end):
 * read paths, chat lifecycle with event subscription, write-boundary codes,
 * and the byte+mtime no-mutation guarantee across the whole session.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  type ResponseErrorFrameT,
  type ResponseOkFrameT,
} from '../../src/shared/protocol';
import { FrameReader } from '../helpers/frameReader';
import { removeBridgeBundle, spawnBridge } from '../helpers/bridgeFixture';

const FAKE_PI_RPC = path.join(__dirname, '..', 'fixtures', 'fake-pi-rpc');
const T0 = new Date('2026-01-01T00:00:00.000Z');

function req(requestId: string, method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'request',
    requestId,
    method,
    ...(params ? { params } : {}),
  });
}

interface Fixture {
  home: string;
  root: string;
  projectDir: string;
  sessionFile: string;
  env: Record<string, string>;
  sha: string;
  mtime: number;
}

function makeFixture(): Fixture {
  const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m1home-'));
  const root = path.join(home, 'sessions');
  const bucket = path.join(root, '--fake-proj--');
  const projectDir = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m1proj-'));
  mkdirSync(bucket, { recursive: true });
  const sessionFile = path.join(bucket, '2026-01-01T00-00-00-000Z_fixture-session.jsonl');
  const lines = [
    JSON.stringify({ type: 'session', version: 3, id: 'fixture-uuid-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: projectDir }),
    JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: 'T', message: { role: 'user', content: 'hello world', timestamp: 1 } }),
    JSON.stringify({ type: 'message', id: 'm2', parentId: 'm1', timestamp: 'T', message: { role: 'assistant', content: [{ type: 'text', text: 'hi!' }], api: 'a', provider: 'p', model: 'm', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 } }),
    JSON.stringify({ type: 'session_info', id: 'n1', parentId: 'm2', timestamp: 'T', name: 'Bridge fixture session' }),
  ];
  writeFileSync(sessionFile, lines.join('\n') + '\n');
  utimesSync(sessionFile, T0, T0); // well outside the active-write window
  const env: Record<string, string> = {
    HOME: home,
    PI_CODING_AGENT_SESSION_DIR: root,
    PI_WS_DESKTOP_PI: FAKE_PI_RPC,
  };
  const sha = createHash('sha256').update(readFileSync(sessionFile)).digest('hex');
  const mtime = statSync(sessionFile).mtimeMs;
  return { home, root, projectDir, sessionFile, env, sha, mtime };
}

function ok(result: ResponseOkFrameT): unknown {
  return result.result;
}
function errCode(e: ResponseErrorFrameT): string {
  return e.error.code;
}
/** Discriminates a response frame without relying on a literal union:
 * both ok/error frames are `{type:'response'}`; an error carries `.error`. */
function verdictOf(frame: unknown): string {
  const f = frame as { type?: string; error?: { code?: string } } | null;
  return f && f.type === 'response' && f.error ? (f.error.code ?? 'unknown') : 'ok';
}

afterAll(async () => {
  await removeBridgeBundle();
});

describe('bridge M1 read paths (real subprocess)', () => {
  it('listProjects/listSessions/readSession/search + invalid params + boundary, file untouched', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');

      child.stdin.write(req('p1', 'listProjects') + '\n');
      const projects = ok((await reader.waitForResponse('p1')).frame as ResponseOkFrameT) as {
        projects: Array<{ path: string; sessionCount: number; lastActivityAt: string | null }>;
        diagnostics: string[];
      };
      expect(projects.projects).toHaveLength(1);
      expect(projects.projects[0].path).toBe(fx.projectDir);
      expect(projects.projects[0].sessionCount).toBe(1);

      child.stdin.write(req('s1', 'listSessions', { projectId: fx.projectDir }) + '\n');
      const sessions = ok((await reader.waitForResponse('s1')).frame as ResponseOkFrameT) as {
        sessions: Array<{ id: string; name: string | null; availability: string; activeWrite: boolean; version: number }>;
      };
      expect(sessions.sessions).toHaveLength(1);
      expect(sessions.sessions[0]).toMatchObject({
        id: 'fixture-uuid-1',
        name: 'Bridge fixture session',
        availability: 'ok',
        activeWrite: false,
        version: 3,
      });

      child.stdin.write(req('r1', 'readSession', { file: fx.sessionFile }) + '\n');
      const read = ok((await reader.waitForResponse('r1')).frame as ResponseOkFrameT) as {
        header: { cwd: string } | null;
        entries: Array<{ id: string | null; type: string }>;
        leafId: string | null;
        partialTrailing: boolean;
        availability: string;
      };
      expect(read.header?.cwd).toBe(fx.projectDir);
      expect(read.entries.map((e) => e.id)).toEqual(['m1', 'm2', 'n1']);
      expect(read.leafId).toBe('n1');
      expect(read.partialTrailing).toBe(false);
      expect(read.availability).toBe('ok');

      // metadata search by default; content only with explicit flag
      child.stdin.write(req('q1', 'searchSessions', { query: 'hello world' }) + '\n');
      const meta = ok((await reader.waitForResponse('q1')).frame as ResponseOkFrameT) as { matches: unknown[] };
      expect(meta.matches).toEqual([]);
      child.stdin.write(req('q2', 'searchSessions', { query: 'hello world', includeContent: true }) + '\n');
      const content = ok((await reader.waitForResponse('q2')).frame as ResponseOkFrameT) as {
        matches: Array<{ field: string; line: number }>;
      };
      expect(content.matches).toEqual([expect.objectContaining({ field: 'content', line: 2 })]);

      // invalid params and boundary
      child.stdin.write(req('bad1', 'readSession', { file: '' }) + '\n');
      expect(errCode((await reader.waitForResponse('bad1')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');
      child.stdin.write(req('bad2', 'deleteSession', {}) + '\n');
      expect(errCode((await reader.waitForResponse('bad2')).frame as ResponseErrorFrameT)).toBe('METHOD_NOT_ALLOWED');

      // getState with no chat open
      child.stdin.write(req('g0', 'getState') + '\n');
      expect(ok((await reader.waitForResponse('g0')).frame as ResponseOkFrameT)).toEqual({ state: null });

      // no chat events without subscription/open
      const chatFrames = reader.frames.filter((f) => f.frame?.type === 'event' && f.frame.event === 'chat');
      expect(chatFrames).toHaveLength(0);
    } finally {
      child.kill();
    }
    // byte + mtime identical after the full read-path battery
    expect(createHash('sha256').update(readFileSync(fx.sessionFile)).digest('hex')).toBe(fx.sha);
    expect(statSync(fx.sessionFile).mtimeMs).toBe(fx.mtime);
  });
});

describe('bridge M1 active-window env hook', () => {
  it('PI_WS_DESKTOP_ACTIVE_WINDOW_MS=0 disables the active-write gate (fresh files open)', async () => {
    const fx = makeFixture();
    utimesSync(fx.sessionFile, new Date(), new Date()); // brand new mtime — would normally conflict
    const child = await spawnBridge({ ...fx.env, PI_WS_DESKTOP_ACTIVE_WINDOW_MS: '0' });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('w1', 'openSession', { file: fx.sessionFile }) + '\n');
      const resp = (await reader.waitForResponse('w1')).frame;
      expect(resp).toMatchObject({ type: 'response', status: 'ok' });
    } finally {
      child.kill();
      utimesSync(fx.sessionFile, T0, T0);
    }
  });
});

describe('bridge M1 chat lifecycle (real subprocess, fake pi RPC)', () => {
  it('subscribe → open → prompt stream → interrupt → close; conflict/busy codes; file untouched', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    const chatEvent = (kind: string, name?: string) =>
      reader.waitFor((f) => {
        const fr = f.frame;
        if (!fr || fr.type !== 'event' || fr.event !== 'chat') return false;
        const payload = fr.payload as { kind: string; name?: string };
        return payload.kind === kind && (name === undefined || payload.name === name);
      }, 8_000);
    try {
      await reader.waitForEvent('ready');

      child.stdin.write(req('sub', 'subscribeEvents', { topic: 'chat' }) + '\n');
      expect(ok((await reader.waitForResponse('sub')).frame as ResponseOkFrameT)).toEqual({ subscribed: true });

      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      const opened = ok((await reader.waitForResponse('o1')).frame as ResponseOkFrameT) as {
        state: { sessionFile: string; isStreaming: boolean; model: { id: string } | null };
      };
      expect(opened.state.sessionFile).toBe(fx.sessionFile);
      expect(opened.state.isStreaming).toBe(false);
      await chatEvent('opened');

      // second open while alive → RESOURCE_BUSY
      child.stdin.write(req('o2', 'openSession', { file: fx.sessionFile }) + '\n');
      expect(errCode((await reader.waitForResponse('o2')).frame as ResponseErrorFrameT)).toBe('RESOURCE_BUSY');

      child.stdin.write(req('st1', 'getState') + '\n');
      const state = ok((await reader.waitForResponse('st1')).frame as ResponseOkFrameT) as { state: { model: { id: string } | null } };
      expect(state.state?.model?.id).toBe('fake-model');

      child.stdin.write(req('pr1', 'sendPrompt', { message: 'do the thing' }) + '\n');
      const prompt = ok((await reader.waitForResponse('pr1')).frame as ResponseOkFrameT) as { disposition: string };
      expect(prompt.disposition).toBe('started');
      await chatEvent('pi', 'agent_settled'); // stream really flowed to the subscriber

      // capabilities list the full M1 surface
      child.stdin.write(req('cap', 'getCapabilities') + '\n');
      const caps = ok((await reader.waitForResponse('cap')).frame as ResponseOkFrameT) as { methods: string[] };
      for (const m of ['listProjects', 'readSession', 'sendPrompt', 'closeSession', 'health']) {
        expect(caps.methods).toContain(m);
      }

      child.stdin.write(req('i1', 'interrupt') + '\n');
      expect(ok((await reader.waitForResponse('i1')).frame as ResponseOkFrameT)).toEqual({ interrupted: true });

      child.stdin.write(req('cl1', 'closeSession') + '\n');
      expect(ok((await reader.waitForResponse('cl1')).frame as ResponseOkFrameT)).toEqual({ closed: true });
      const closedEv = await chatEvent('closed');
      const closedFrame = closedEv.frame;
      expect(closedFrame?.type === 'event' ? (closedFrame.payload as { code: string }).code : 'no-event').toBe('CANCELLED');

      // active-write conflict: simulate a live CLI appending right now
      utimesSync(fx.sessionFile, new Date(), new Date());
      child.stdin.write(req('o3', 'openSession', { file: fx.sessionFile }) + '\n');
      expect(errCode((await reader.waitForResponse('o3')).frame as ResponseErrorFrameT)).toBe('SESSION_CONFLICT');
      utimesSync(fx.sessionFile, T0, T0); // restore the baseline

      // missing file → SESSION_NOT_FOUND, nothing spawned
      child.stdin.write(req('o4', 'openSession', { file: path.join(fx.root, 'gone.jsonl') }) + '\n');
      expect(errCode((await reader.waitForResponse('o4')).frame as ResponseErrorFrameT)).toBe('SESSION_NOT_FOUND');
    } finally {
      child.kill();
    }
    // restore-then-verify: the bridge itself never wrote a byte (the conflict
    // step manipulated mtime from the TEST side only)
    utimesSync(fx.sessionFile, T0, T0);
    expect(createHash('sha256').update(readFileSync(fx.sessionFile)).digest('hex')).toBe(fx.sha);
    expect(statSync(fx.sessionFile).mtimeMs).toBe(fx.mtime);
  });
});

describe('bridge M1 newSession — real creation over bare Pi RPC (R03 п.2)', () => {
  it('creates a named provisional session, enforces the single slot, validates params', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');

      // contract: unsafe params are rejected before any spawn
      child.stdin.write(req('bad1', 'newSession', { projectPath: 'relative/dir' }) + '\n');
      expect(errCode((await reader.waitForResponse('bad1')).frame as ResponseErrorFrameT)).toBe(
        'INVALID_REQUEST',
      );
      child.stdin.write(req('bad2', 'newSession', { exec: 'anything' }) + '\n');
      expect(errCode((await reader.waitForResponse('bad2')).frame as ResponseErrorFrameT)).toBe(
        'INVALID_REQUEST',
      );

      // real creation: bare `--mode rpc` spawn → get_state → concrete file
      child.stdin.write(req('n1', 'newSession', { projectPath: fx.projectDir }) + '\n');
      const created = ok((await reader.waitForResponse('n1')).frame as ResponseOkFrameT) as {
        state: { sessionId: string | null; sessionFile: string | null; messageCount: number };
        session: {
          id: string;
          file: string;
          root: string;
          projectId: string;
          projectPath: string;
          name: string | null;
          createdAt: string | null;
          updatedAt: string;
          sizeBytes: number;
          version: number;
          availability: string;
          activeWrite: boolean;
          diagnostics: string | null;
        };
      };
      // the file path comes from Pi's own get_state — under the session root,
      // never the fixture file, never outside the env session dir
      expect(created.state.sessionFile).toBeTruthy();
      expect(created.state.sessionFile?.startsWith(fx.root)).toBe(true);
      expect(created.state.sessionFile).not.toBe(fx.sessionFile);
      expect(created.state.sessionFile?.endsWith('.jsonl')).toBe(true);
      // honest provisional record: real id from state, no invented history
      expect(created.session).toMatchObject({
        id: created.state.sessionId ?? '',
        file: created.state.sessionFile ?? '',
        root: fx.root,
        projectId: fx.projectDir,
        projectPath: fx.projectDir,
        name: 'Новый диалог',
        createdAt: null,
        sizeBytes: 0,
        version: 1,
        availability: 'empty',
        activeWrite: false,
        diagnostics: null,
      });
      expect(typeof created.session.updatedAt).toBe('string');

      // single chat slot: no auto-close, second create → RESOURCE_BUSY
      child.stdin.write(req('n2', 'newSession', {}) + '\n');
      expect(errCode((await reader.waitForResponse('n2')).frame as ResponseErrorFrameT)).toBe(
        'RESOURCE_BUSY',
      );

      // mirrors Pi (_hasConversation): nothing hits the disk before the first
      // message — and the index therefore does not claim the session yet
      expect(existsSync(created.state.sessionFile ?? '/definitely/missing')).toBe(false);
      child.stdin.write(req('sl', 'listSessions', {}) + '\n');
      const listed = ok((await reader.waitForResponse('sl')).frame as ResponseOkFrameT) as {
        sessions: Array<{ file: string }>;
      };
      expect(listed.sessions.map((s) => s.file)).not.toContain(created.state.sessionFile);

      // close releases the slot; a param-less create still resolves a file
      child.stdin.write(req('cl', 'closeSession') + '\n');
      expect(ok((await reader.waitForResponse('cl')).frame as ResponseOkFrameT)).toEqual({ closed: true });
      child.stdin.write(req('n3', 'newSession', {}) + '\n');
      const created2 = ok((await reader.waitForResponse('n3')).frame as ResponseOkFrameT) as {
        state: { sessionFile: string | null };
      };
      expect(created2.state.sessionFile).toBeTruthy();
      expect(created2.state.sessionFile).not.toBe(created.state.sessionFile);
    } finally {
      child.kill();
    }
  });

  it('sendPrompt survives the un-materialized file, then the run persists it honestly', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    const chatEvent = (kind: string, name?: string) =>
      reader.waitFor((f) => {
        const fr = f.frame;
        if (!fr || fr.type !== 'event' || fr.event !== 'chat') return false;
        const payload = fr.payload as { kind: string; name?: string };
        return payload.kind === kind && (name === undefined || payload.name === name);
      }, 8_000);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sub', 'subscribeEvents', { topic: 'chat' }) + '\n');
      expect(ok((await reader.waitForResponse('sub')).frame as ResponseOkFrameT)).toEqual({ subscribed: true });

      child.stdin.write(req('nc', 'newSession', { projectPath: fx.projectDir }) + '\n');
      const created = ok((await reader.waitForResponse('nc')).frame as ResponseOkFrameT) as {
        state: { sessionFile: string | null };
      };
      const newFile = created.state.sessionFile ?? '';
      expect(newFile).toBeTruthy();

      // the idle-time external-writer stat must NOT fail the first prompt on
      // the not-yet-existing file (no external writer can touch nothing)
      child.stdin.write(req('pr', 'sendPrompt', { message: 'первый реплике' }) + '\n');
      const prompt = ok((await reader.waitForResponse('pr')).frame as ResponseOkFrameT) as {
        disposition: string;
      };
      expect(prompt.disposition).toBe('started');
      await chatEvent('pi', 'agent_settled');

      // fake mirrors Pi: the first message materializes the file with the
      // durable session_info name queued by set_session_name
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(existsSync(newFile)).toBe(true);
      child.stdin.write(req('rd', 'readSession', { file: newFile }) + '\n');
      const read = ok((await reader.waitForResponse('rd')).frame as ResponseOkFrameT) as {
        header: { cwd: string } | null;
        entries: Array<{
          type: string;
          raw: { name?: string; message?: { role: string; content: unknown } };
        }>;
        availability: string;
      };
      expect(read.header?.cwd).toBe(fx.projectDir);
      expect(read.availability).toBe('ok');
      const info = read.entries.find((e) => e.type === 'session_info');
      expect(info?.raw.name).toBe('Новый диалог');
      const roles = read.entries.filter((e) => e.type === 'message').map((e) => e.raw.message?.role);
      expect(roles).toContain('user');
      expect(roles).toContain('assistant');

      // the session now exists for discovery, in the same project
      child.stdin.write(req('sl', 'listSessions', {}) + '\n');
      const listed = ok((await reader.waitForResponse('sl')).frame as ResponseOkFrameT) as {
        sessions: Array<{ file: string; name: string | null; projectPath: string }>;
      };
      const row = listed.sessions.find((s) => s.file === newFile);
      expect(row).toBeTruthy();
      expect(row?.name).toBe('Новый диалог');
      expect(row?.projectPath).toBe(fx.projectDir);

      // second prompt: the post-run idle baseline accepts our own append
      child.stdin.write(req('pr2', 'sendPrompt', { message: 'второй' }) + '\n');
      const prompt2 = ok((await reader.waitForResponse('pr2')).frame as ResponseOkFrameT) as {
        disposition: string;
      };
      expect(prompt2.disposition).toBe('started');
      await chatEvent('pi', 'agent_settled');
      await new Promise((resolve) => setTimeout(resolve, 200));

      // review P2-8: BOTH user prompts persist — the created session keeps
      // accepting turns (the transcript is two complete turns end to end)
      child.stdin.write(req('rd2', 'readSession', { file: newFile }) + '\n');
      const read2 = ok((await reader.waitForResponse('rd2')).frame as ResponseOkFrameT) as {
        entries: Array<{ type: string; raw: { message?: { role: string } } }>;
      };
      const roleSeq = read2.entries.filter((e) => e.type === 'message').map((e) => e.raw.message?.role);
      expect(roleSeq).toEqual(['user', 'assistant', 'user', 'assistant']);
    } finally {
      child.kill();
    }
  });
});

describe('bridge M1 review fixes — slot reservation and fail-closed stat (R03)', () => {
  it('review P1-3: concurrent newSession/newSession resolves exactly one RESOURCE_BUSY', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      // both requests are IN FLIGHT before either handler finishes
      child.stdin.write(req('q1', 'newSession', {}) + '\n');
      child.stdin.write(req('q2', 'newSession', {}) + '\n');
      const [r1, r2] = await Promise.all([reader.waitForResponse('q1'), reader.waitForResponse('q2')]);
      const verdict = [r1, r2].map((r) => verdictOf(r.frame));
      expect(verdict.filter((v) => v === 'RESOURCE_BUSY')).toHaveLength(1);
      expect(verdict.filter((v) => v === 'ok')).toHaveLength(1);
    } finally {
      child.kill();
    }
  });

  it('review P1-3: concurrent newSession/openSession share the single slot', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('q1', 'newSession', {}) + '\n');
      child.stdin.write(req('q2', 'openSession', { file: fx.sessionFile }) + '\n');
      const [r1, r2] = await Promise.all([reader.waitForResponse('q1'), reader.waitForResponse('q2')]);
      const verdict = [r1, r2].map((r) => verdictOf(r.frame));
      expect(verdict.filter((v) => v === 'RESOURCE_BUSY')).toHaveLength(1);
      expect(verdict.filter((v) => v === 'ok')).toHaveLength(1);
    } finally {
      child.kill();
    }
  });

  it('review P1-6: pending-materialization stat tolerates ONLY ENOENT — EACCES fails closed before any prompt', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('nc', 'newSession', {}) + '\n');
      const created = ok((await reader.waitForResponse('nc')).frame as ResponseOkFrameT) as {
        state: { sessionFile: string | null };
      };
      const newFile = created.state.sessionFile ?? '';
      expect(newFile).toBeTruthy();
      expect(existsSync(newFile)).toBe(false);

      // make the SESSION DIR unreadable: stat(file) now fails with EACCES
      // (not ENOENT) — an indeterminate state must block the prompt
      chmodSync(fx.root, 0o000);
      child.stdin.write(req('pr', 'sendPrompt', { message: 'не должен уйти' }) + '\n');
      const resp = await reader.waitForResponse('pr');
      expect(verdictOf(resp.frame)).toBe('SESSION_CONFLICT');
      chmodSync(fx.root, 0o755);
      // no prompt was transmitted: nothing ever materialized on disk
      expect(existsSync(newFile)).toBe(false);
    } finally {
      chmodSync(fx.root, 0o755); // idempotent restore keeps the fixture reusable
      child.kill();
    }
  });
});

describe('bridge M1 path scope (review round 3, #4 — defense-in-depth)', () => {
  it('readSession/openSession reject files outside the session roots', async () => {
    const fx = makeFixture();
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'piwsd-outside-'));
    const outsideFile = path.join(outsideDir, 'foreign.jsonl');
    writeFileSync(outsideFile, `${JSON.stringify({ type: 'session', version: 3, id: 'x', timestamp: 'T', cwd: '/p' })}\n`);
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');

      child.stdin.write(req('x1', 'readSession', { file: outsideFile }) + '\n');
      const e1 = (await reader.waitForResponse('x1')).frame as ResponseErrorFrameT;
      expect(errCode(e1)).toBe('INVALID_REQUEST');
      expect(e1.error.message).toContain('outside the session roots');

      // traversal must not escape the root either
      child.stdin.write(req('x2', 'readSession', { file: path.join(fx.root, '..', 'escaped.jsonl') }) + '\n');
      expect(errCode((await reader.waitForResponse('x2')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');

      child.stdin.write(req('x3', 'openSession', { file: outsideFile, projectCwd: fx.projectDir }) + '\n');
      expect(errCode((await reader.waitForResponse('x3')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');

      // the legit fixture file inside the root still reads fine
      child.stdin.write(req('x4', 'readSession', { file: fx.sessionFile }) + '\n');
      const okFrame = (await reader.waitForResponse('x4')).frame as ResponseOkFrameT;
      expect(okFrame.type).toBe('response');
    } finally {
      child.kill();
    }
  });
});

describe('bridge M2 canonical path hardening — symlink escape (P2#2)', () => {
  it('rejects read and open through a symlink to outside roots, but permits an in-root symlink', async () => {
    const fx = makeFixture();
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m2-foreign-'));
    const outsideFile = path.join(outsideDir, 'foreign.jsonl');
    writeFileSync(outsideFile, readFileSync(fx.sessionFile));
    utimesSync(outsideFile, T0, T0);
    const insideLink = path.join(fx.root, 'in-root.jsonl');
    const outsideLink = path.join(fx.root, 'outside.jsonl');
    symlinkSync(fx.sessionFile, insideLink);
    symlinkSync(outsideFile, outsideLink);
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sl1', 'readSession', { file: insideLink }) + '\n');
      expect(((await reader.waitForResponse('sl1')).frame as ResponseOkFrameT).status).toBe('ok');

      child.stdin.write(req('sl2', 'readSession', { file: outsideLink }) + '\n');
      const rejectedRead = (await reader.waitForResponse('sl2')).frame as ResponseErrorFrameT;
      expect(errCode(rejectedRead)).toBe('INVALID_REQUEST');
      expect(rejectedRead.error.message).toContain('outside the session roots');

      child.stdin.write(req('sl3', 'openSession', { file: outsideLink }) + '\n');
      expect(errCode((await reader.waitForResponse('sl3')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');

      // Retarget a previously accepted link: the next request must recheck
      // the real inode/target, not trust cached lexical or resolved paths.
      unlinkSync(insideLink);
      symlinkSync(outsideFile, insideLink);
      child.stdin.write(req('sl4', 'readSession', { file: insideLink }) + '\n');
      expect(errCode((await reader.waitForResponse('sl4')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }
    expect(createHash('sha256').update(readFileSync(fx.sessionFile)).digest('hex')).toBe(fx.sha);
  });

  it('rejects a symlinked parent directory that escapes the trusted root', async () => {
    const fx = makeFixture();
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'piwsd-m2-parent-'));
    const outsideFile = path.join(outsideDir, 'foreign.jsonl');
    writeFileSync(outsideFile, readFileSync(fx.sessionFile));
    symlinkSync(outsideDir, path.join(fx.root, 'escape-dir'), 'dir');
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sl5', 'readSession', { file: path.join(fx.root, 'escape-dir', 'foreign.jsonl') }) + '\n');
      expect(errCode((await reader.waitForResponse('sl5')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }
  });
});

describe('bridge M1 root normalization (review round 4)', () => {
  it('accepts legit files under a non-normalized (double-slash) session root', async () => {
    const fx = makeFixture();
    const messyRoot = fx.root.replace('/sessions', '//sessions'); // redundant separator in env
    const child = await spawnBridge({ ...fx.env, PI_CODING_AGENT_SESSION_DIR: messyRoot });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('n1', 'readSession', { file: fx.sessionFile }) + '\n');
      const frame = (await reader.waitForResponse('n1')).frame as ResponseOkFrameT;
      expect(frame.status).toBe('ok');
    } finally {
      child.kill();
    }
  });
});
