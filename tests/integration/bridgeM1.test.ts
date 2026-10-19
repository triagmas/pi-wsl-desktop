/**
 * T6b — M1 surface over a REAL bridge subprocess (NDJSON end-to-end):
 * read paths, chat lifecycle with event subscription, write-boundary codes,
 * and the byte+mtime no-mutation guarantee across the whole session.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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
