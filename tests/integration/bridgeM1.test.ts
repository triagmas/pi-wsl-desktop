/**
 * T6b — M1 surface over a REAL bridge subprocess (NDJSON end-to-end):
 * read paths, chat lifecycle with event subscription, write-boundary codes,
 * and the byte+mtime no-mutation guarantee across the whole session.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
  originalText: string;
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
  const originalText = readFileSync(sessionFile, 'utf8');
  const sha = createHash('sha256').update(readFileSync(sessionFile)).digest('hex');
  const mtime = statSync(sessionFile).mtimeMs;
  return { home, root, projectDir, sessionFile, env, sha, mtime, originalText };
}

function ok(result: ResponseOkFrameT): unknown {
  return result.result;
}
function errCode(e: ResponseErrorFrameT): string {
  return e.error.code;
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
      // UI26 R03: getState additionally reports whether the session JSONL exists
      // (read-only fact used for delayed materialization) — no chat, so false.
      expect(ok((await reader.waitForResponse('g0')).frame as ResponseOkFrameT)).toEqual({
        state: null,
        sessionFileExists: false,
      });

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

describe('UI21-F2 model catalog & selector over the real bridge', () => {
  it('lists Pi models, switches model/thinking, and rejects changes while streaming', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sub', 'subscribeEvents', { topic: 'chat' }) + '\n');
      await reader.waitForResponse('sub');

      // before any session: no live Pi → explicit disconnect, never a fabricated catalog
      child.stdin.write(req('m0', 'getAvailableModels') + '\n');
      expect(errCode((await reader.waitForResponse('m0')).frame as ResponseErrorFrameT)).toBe('DISCONNECTED');

      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');

      // catalog comes from Pi (fake fixture declares two providers — no hardcoding here)
      child.stdin.write(req('m1', 'getAvailableModels') + '\n');
      const models = ok((await reader.waitForResponse('m1')).frame as ResponseOkFrameT) as {
        models: Array<{ provider: string; id: string; name: string }>;
      };
      expect(models.models.map((m) => `${m.provider}/${m.id}`)).toEqual(['prov-a/model-one', 'prov-b/model-two']);

      // thinking levels for the selected model come from Pi
      child.stdin.write(req('t1', 'getThinkingLevels') + '\n');
      const levels = ok((await reader.waitForResponse('t1')).frame as ResponseOkFrameT) as {
        levels: string[];
        current: string | null;
      };
      expect(levels.levels).toEqual(['off', 'high']);
      expect(levels.current).toBe('medium');

      // switch model → authoritative state comes from a fresh get_state
      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      const switched = ok((await reader.waitForResponse('s1')).frame as ResponseOkFrameT) as {
        state: { model: { provider: string; id: string; name: string } | null };
      };
      expect(switched.state.model).toEqual({ provider: 'prov-b', id: 'model-two', name: 'Model Two' });

      // switch thinking level → same authoritative path
      child.stdin.write(req('s2', 'setThinkingLevel', { level: 'high' }) + '\n');
      const think = ok((await reader.waitForResponse('s2')).frame as ResponseOkFrameT) as {
        state: { thinkingLevel: string | null };
      };
      expect(think.state.thinkingLevel).toBe('high');

      // unknown model → Pi's failure surfaces as an error, never a silent fallback
      child.stdin.write(req('s3', 'setModel', { provider: 'prov-a', modelId: 'nope' }) + '\n');
      expect(errCode((await reader.waitForResponse('s3')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');

      // invalid thinking level is rejected by the bridge before touching Pi
      child.stdin.write(req('s4', 'setThinkingLevel', { level: '' }) + '\n');
      expect(errCode((await reader.waitForResponse('s4')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }
    // R02: a confirmed switch legitimately appends model_change/thinking_level_change
    // to the session (real Pi behaviour) — original history must stay byte-identical
    // and only OUR switch records may be added.
    const after = readFileSync(fx.sessionFile, 'utf8');
    expect(after.startsWith(fx.originalText)).toBe(true);
    const appended = after.slice(fx.originalText.length).split('\n').filter((l) => l.trim() !== '');
    // native Pi: model_change, then the effective-level change forced by the
    // non-reasoning model ("off"), then our explicit thinking switch to "high"
    expect(appended.map((l) => (JSON.parse(l) as { type: string }).type)).toEqual([
      'model_change',
      'thinking_level_change',
      'thinking_level_change',
    ]);
  });

  it('rejects a switch ACK that get_state cannot confirm (null model/level) — no false PASS', async () => {
    const fx = makeFixture();
    const child = await spawnBridge({ ...fx.env, FAKE_PI_MODE: 'model-null' });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');
      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      expect(errCode((await reader.waitForResponse('s1')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');
    } finally {
      child.kill();
    }

    const child2 = await spawnBridge({ ...fx.env, FAKE_PI_MODE: 'thinking-null' });
    const reader2 = new FrameReader(child2.stdout);
    try {
      await reader2.waitForEvent('ready');
      child2.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader2.waitForResponse('o1');
      child2.stdin.write(req('s1', 'setThinkingLevel', { level: 'high' }) + '\n');
      expect(errCode((await reader2.waitForResponse('s1')).frame as ResponseErrorFrameT)).toBe('INVALID_REQUEST');
    } finally {
      child2.kill();
    }
  });

  it('refuses model/thinking changes while a run is streaming (RESOURCE_BUSY, no silent switch)', async () => {
    const fx = makeFixture();
    const child = await spawnBridge({ ...fx.env, FAKE_PI_STREAM_MS: '300' });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sub', 'subscribeEvents', { topic: 'chat' }) + '\n');
      await reader.waitForResponse('sub');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');
      child.stdin.write(req('p1', 'sendPrompt', { message: 'hello' }) + '\n');
      await reader.waitForResponse('p1');

      child.stdin.write(req('b1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      expect(errCode((await reader.waitForResponse('b1')).frame as ResponseErrorFrameT)).toBe('RESOURCE_BUSY');
      child.stdin.write(req('b2', 'setThinkingLevel', { level: 'high' }) + '\n');
      expect(errCode((await reader.waitForResponse('b2')).frame as ResponseErrorFrameT)).toBe('RESOURCE_BUSY');
    } finally {
      child.kill();
    }
  });
});

describe('UI21 R02: switch writes vs the idle external-writer gate', () => {
  it('own switch append does not cause a false SESSION_CONFLICT on the next prompt', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sub', 'subscribeEvents', { topic: 'chat' }) + '\n');
      await reader.waitForResponse('sub');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');

      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      expect(ok((await reader.waitForResponse('s1')).frame as ResponseOkFrameT)).toMatchObject({ state: { model: { id: 'model-two' } } });

      // the switch appended model_change to OUR file — the next prompt must pass the gate
      child.stdin.write(req('p1', 'sendPrompt', { message: 'after switch' }) + '\n');
      const prompt = (await reader.waitForResponse('p1')).frame;
      expect(prompt).toMatchObject({ type: 'response', status: 'ok' });
      expect(ok(prompt as ResponseOkFrameT)).toMatchObject({ disposition: 'started' });
    } finally {
      child.kill();
    }
  });

  it('refuses to switch when another writer touched the idle session (fail closed, no mutation)', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');

      // a CLI appends while the chat sits idle
      writeFileSync(
        fx.sessionFile,
        `${JSON.stringify({ type: 'message', id: 'cli-1', parentId: null, timestamp: 'T', message: { role: 'user', content: 'cli', timestamp: 3 } })}\n`,
        { flag: 'a' },
      );

      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      expect(errCode((await reader.waitForResponse('s1')).frame as ResponseErrorFrameT)).toBe('SESSION_CONFLICT');
      child.stdin.write(req('s2', 'setThinkingLevel', { level: 'high' }) + '\n');
      expect(errCode((await reader.waitForResponse('s2')).frame as ResponseErrorFrameT)).toBe('SESSION_CONFLICT');

      // and nothing of ours was written
      expect(readFileSync(fx.sessionFile, 'utf8')).not.toContain('model_change');
      expect(readFileSync(fx.sessionFile, 'utf8')).not.toContain('thinking_level_change');
    } finally {
      child.kill();
    }
  });

  it('does not absorb an unrelated append that races with the switch RPC', async () => {
    const fx = makeFixture();
    const child = await spawnBridge({ ...fx.env, FAKE_PI_MODE: 'switch-race' });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');
      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      // two records appeared (our model_change + a foreign message) → cannot attribute
      expect(errCode((await reader.waitForResponse('s1')).frame as ResponseErrorFrameT)).toBe('SESSION_CONFLICT');
      // the foreign write is still on disk — we never truncate or rewrite it
      expect(readFileSync(fx.sessionFile, 'utf8')).toContain('cli wrote here');
    } finally {
      child.kill();
    }
  });
});

describe('UI21 R02 r01: native Pi may append model_change + thinking_level_change', () => {
  it('accepts a switch that writes ONLY model_change (thinking level unchanged)', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');
      // model-one is reasoning-capable → Pi keeps the effective level, one record
      child.stdin.write(req('s1', 'setModel', { provider: 'prov-a', modelId: 'model-one' }) + '\n');
      expect(ok((await reader.waitForResponse('s1')).frame as ResponseOkFrameT)).toMatchObject({
        state: { model: { provider: 'prov-a', id: 'model-one' }, thinkingLevel: 'medium' },
      });
      const appended = readFileSync(fx.sessionFile, 'utf8').slice(fx.originalText.length).split('\n').filter((l) => l.trim() !== '');
      expect(appended.map((l) => (JSON.parse(l) as { type: string }).type)).toEqual(['model_change']);
    } finally {
      child.kill();
    }
  });

  it('accepts the native TWO-record sequence and the next prompt still passes the gate', async () => {
    const fx = makeFixture();
    const child = await spawnBridge(fx.env);
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('sub', 'subscribeEvents', { topic: 'chat' }) + '\n');
      await reader.waitForResponse('sub');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');
      // raise the level so switching to a non-reasoning model forces "off"
      child.stdin.write(req('t1', 'setThinkingLevel', { level: 'high' }) + '\n');
      await reader.waitForResponse('t1');

      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      const switched = ok((await reader.waitForResponse('s1')).frame as ResponseOkFrameT) as {
        state: { model: { id: string }; thinkingLevel: string | null };
      };
      expect(switched.state.model.id).toBe('model-two');
      expect(switched.state.thinkingLevel).toBe('off');

      const appended = readFileSync(fx.sessionFile, 'utf8').slice(fx.originalText.length).split('\n').filter((l) => l.trim() !== '');
      expect(appended.map((l) => (JSON.parse(l) as { type: string }).type)).toEqual([
        'thinking_level_change', // our explicit level change
        'model_change',
        'thinking_level_change', // native follow-up from setModel
      ]);

      // the double write must not be mistaken for a foreign writer
      child.stdin.write(req('p1', 'sendPrompt', { message: 'after native double write' }) + '\n');
      expect((await reader.waitForResponse('p1')).frame).toMatchObject({ type: 'response', status: 'ok' });
    } finally {
      child.kill();
    }
  });

  it('still rejects a foreign record appended after the native two-record sequence', async () => {
    const fx = makeFixture();
    const child = await spawnBridge({ ...fx.env, FAKE_PI_MODE: 'switch-race' });
    const reader = new FrameReader(child.stdout);
    try {
      await reader.waitForEvent('ready');
      child.stdin.write(req('o1', 'openSession', { file: fx.sessionFile }) + '\n');
      await reader.waitForResponse('o1');
      child.stdin.write(req('t1', 'setThinkingLevel', { level: 'high' }) + '\n');
      await reader.waitForResponse('t1');
      child.stdin.write(req('s1', 'setModel', { provider: 'prov-b', modelId: 'model-two' }) + '\n');
      expect(errCode((await reader.waitForResponse('s1')).frame as ResponseErrorFrameT)).toBe('SESSION_CONFLICT');
      // the foreign bytes are preserved — we never truncate or rewrite them
      expect(readFileSync(fx.sessionFile, 'utf8')).toContain('cli wrote here');
    } finally {
      child.kill();
    }
  });
});
