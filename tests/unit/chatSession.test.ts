/**
 * RED gate T6a — ChatSessionManager write-boundary & CLI/GUI concurrency
 * policies (SPEC §3.3, Issue #5 gate 5):
 *  - SESSION_NOT_FOUND for a missing file;
 *  - SESSION_CONFLICT when the file was recently written (live CLI) OR
 *    changes while our chat sits IDLE (external writer) — prompt is NOT sent;
 *  - RESOURCE_BUSY for a second open; Pi's own "streaming" rejection maps too;
 *  - crashes free the slot with a `closed` event and never auto-replay;
 *  - open failures tear the spawned process down (no zombies);
 *  - writes happen only through the official RPC spawn (`--session <file>`).
 */
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ChatSessionManager } from '../../src/bridge/chatSession';
import { BridgeError } from '../../src/shared/errors';
import type { ChatEventT } from '../../src/shared/m1Protocol';
import type { RpcProcess } from '../../src/bridge/piRpcClient';

interface FakePi {
  proc: RpcProcess & { stdin: PassThrough; stdout: PassThrough };
  killed: boolean;
  sent: string[];
  emit: (o: unknown) => void;
  exit: (code: number | null) => void;
  /** Commands the client wrote (parsed). */
  commands: () => Array<Record<string, unknown>>;
}

function makeFakePi(): FakePi {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const sent: string[] = [];
  stdin.on('data', (c: Buffer) => sent.push(c.toString('utf8')));
  const fake = {
    killed: false,
    sent,
    proc: {
      stdin,
      stdout,
      kill: () => {
        fake.killed = true;
        emitter.emit('exit', null, 'SIGKILL');
      },
      on: (ev: string, cb: (...args: unknown[]) => void) => emitter.on(ev, cb),
    } as unknown as FakePi['proc'],
    emit: (o: unknown) => stdout.write(`${JSON.stringify(o)}\n`),
    exit: (code: number | null) => emitter.emit('exit', code, null),
    commands: () => sent.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>),
  };
  return fake;
}

interface FileShape {
  mtimeMs: number;
  head: string;
}
function filesFs(files: Record<string, FileShape>) {
  return {
    async readdir() {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    async stat(p: string) {
      const f = files[p];
      if (!f) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { size: 100, mtimeMs: f.mtimeMs };
    },
    async readHead(p: string, max: number) {
      const f = files[p];
      if (!f) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return f.head.slice(0, max);
    },
    async readTail() {
      return '';
    },
    async readRange(p: string, offset: number, length: number) {
      const f = files[p];
      if (!f) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return Buffer.from(f.head ?? '').subarray(offset, offset + length);
    },
  };
}

/** Reply to EVERY command line as it arrives (multi-step handshakes). */
function autoReply(pi: FakePi, handler: (cmd: Record<string, unknown>) => void): void {
  let buf = '';
  pi.proc.stdin.on('data', (c: unknown) => {
    buf += (c as Buffer).toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim() !== '') {
        const cmd = JSON.parse(line) as Record<string, unknown>;
        setImmediate(() => handler(cmd));
      }
    }
  });
}

function replyState(pi: FakePi, cmd: Record<string, unknown>, sessionFile: string): void {
  pi.emit({
    id: cmd.id,
    type: 'response',
    command: 'get_state',
    success: true,
    data: { sessionId: 's1', sessionFile, isStreaming: false, isCompacting: false, messageCount: 1, model: null, thinkingLevel: 'medium' },
  });
}

const FILE = '/roots/--proj--/s.jsonl';
const HEADER = `${JSON.stringify({ type: 'session', version: 3, id: 'u1', timestamp: 'T', cwd: '/home/u/proj' })}\n`;
const NOW = Date.parse('2026-10-19T12:00:00.000Z');

interface Harness {
  manager: ChatSessionManager;
  pi: FakePi;
  events: ChatEventT[];
  files: Record<string, FileShape>;
}

function makeHarness(
  opts: { fileMtime?: number; spawnBehavior?: (fake: FakePi, args: string[], cwd: string) => void } = {},
): Harness {
  const files: Record<string, FileShape> = {
    [FILE]: { mtimeMs: opts.fileMtime ?? NOW - 60_000, head: HEADER },
  };
  const pi = makeFakePi();
  const events: ChatEventT[] = [];
  const manager = new ChatSessionManager({
    fs: filesFs(files) as never,
    home: '/home/u',
    env: {},
    now: () => NOW,
    activeWindowMs: 10_000,
    resolvePi: async () => '/fake/pi',
    spawnRpc: ({ args, cwd }) => {
      if (opts.spawnBehavior) {
        opts.spawnBehavior(pi, args, cwd);
      } else {
        // default responder: answers every command like pi --session does
        autoReply(pi, (cmd) => {
          if (cmd.type === 'get_state') replyState(pi, cmd, FILE);
          else if (cmd.type === 'switch_session') {
            pi.emit({ id: cmd.id, type: 'response', command: 'switch_session', success: true, data: { cancelled: false } });
          }
        });
      }
      return pi.proc;
    },
    onEvent: (ev) => events.push(ev),
    rpcOptions: { commandTimeoutMs: 500, settleTimeoutMs: 500, exitWaitMs: 20 },
  });
  return { manager, pi, events, files };
}

async function expectBridgeError(p: Promise<unknown>, code: string): Promise<BridgeError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe(code);
    return err as BridgeError;
  }
  throw new Error(`expected BridgeError ${code} but the promise resolved`);
}

function respondToPrompt(pi: FakePi, disposition = 'started', opts: { settle?: boolean } = {}): void {
  setImmediate(() => {
    const cmd = pi.commands().filter((c) => c.type === 'prompt').pop();
    if (!cmd) return;
    pi.emit({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition } });
    if (opts.settle !== false && disposition === 'started') {
      pi.emit({ type: 'agent_settled', aborted: false });
    }
  });
}

describe('ChatSessionManager — open boundary', () => {
  it('open: missing file → SESSION_NOT_FOUND, nothing spawned', async () => {
    const h = makeHarness();
    delete h.files[FILE];
    await expectBridgeError(h.manager.open('/roots/--proj--/gone.jsonl'), 'SESSION_NOT_FOUND');
    expect(h.pi.sent).toEqual([]);
  });

  it('open: file modified inside the active window → SESSION_CONFLICT (CLI may be writing)', async () => {
    const h = makeHarness({ fileMtime: NOW - 500 }); // window 10_000
    const err = await expectBridgeError(h.manager.open(FILE), 'SESSION_CONFLICT');
    expect(err.message).toMatch(/CLI|modif/i);
    expect(h.pi.sent).toEqual([]);
  });

  it('open: spawns official RPC with --session <file>, cwd from the header, returns mapped state, emits opened', async () => {
    const h = makeHarness();
    let seenArgs: string[] = [];
    let seenCwd = '';
    const h2 = makeHarness({
      spawnBehavior: (pi, args, cwd) => {
        seenArgs = args;
        seenCwd = cwd;
        autoReply(pi, (cmd) => {
          if (cmd.type === 'get_state') replyState(pi, cmd, FILE);
        });
      },
    });
    const state = await h2.manager.open(FILE);
    expect(seenArgs).toEqual(['--mode', 'rpc', '--session', FILE]);
    expect(seenCwd).toBe('/home/u/proj');
    expect(state).toMatchObject({ sessionId: 's1', sessionFile: FILE, isStreaming: false, model: null });
    expect(h2.events.some((e) => e.kind === 'opened')).toBe(true);
    expect(h2.manager.isOpen).toBe(true);
    await h2.manager.close();
    void h;
  });

  it('open: a second session while one is alive → RESOURCE_BUSY', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    await expectBridgeError(h.manager.open(FILE), 'RESOURCE_BUSY');
    await h.manager.close();
  });

  it('open: get_state never answering → BRIDGE_TIMEOUT and the process is killed (no zombie)', async () => {
    const h = makeHarness({
      spawnBehavior: () => {
        /* never respond */
      },
    });
    await expectBridgeError(h.manager.open(FILE), 'BRIDGE_TIMEOUT');
    expect(h.pi.killed).toBe(true);
    expect(h.manager.isOpen).toBe(false);
  });

  it('open: wrong sessionFile from pi → switch_session is issued (resume by original path)', async () => {
    let asked = false;
    const h = makeHarness({
      spawnBehavior: (pi) => {
        autoReply(pi, (cmd) => {
          if (cmd.type === 'get_state' && !asked) {
            asked = true;
            pi.emit({ id: cmd.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'x', sessionFile: '/somewhere/else.jsonl', isStreaming: false, isCompacting: false, messageCount: 0, model: null } });
          } else if (cmd.type === 'switch_session') {
            pi.emit({ id: cmd.id, type: 'response', command: 'switch_session', success: true, data: { cancelled: false } });
          } else if (cmd.type === 'get_state') {
            replyState(pi, cmd, FILE);
          }
        });
      },
    });
    const state = await h.manager.open(FILE);
    expect(state?.sessionFile).toBe(FILE);
    expect(h.pi.commands().some((c) => c.type === 'switch_session')).toBe(true);
    await h.manager.close();
  });
});

describe('ChatSessionManager — prompt policies', () => {
  it('sendPrompt while closed → DISCONNECTED', async () => {
    const h = makeHarness();
    await expectBridgeError(h.manager.sendPrompt('hi'), 'DISCONNECTED');
  });

  it('sendPrompt happy: returns the disposition and streams events to subscribers', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    respondToPrompt(h.pi, 'started');
    const res = await h.manager.sendPrompt('hello');
    expect(res).toEqual({ disposition: 'started' });
    // let the run promise settle (settled already emitted synchronously above)
    await new Promise((r) => setTimeout(r, 20));
    expect(h.events.some((e) => e.kind === 'pi' && e.name === 'agent_settled')).toBe(true);
    await h.manager.close();
  });

  it('external write while IDLE → next sendPrompt is SESSION_CONFLICT and NOT transmitted', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    respondToPrompt(h.pi, 'started');
    await h.manager.sendPrompt('first');
    await new Promise((r) => setTimeout(r, 30)); // run settles → idle mtime refreshed
    const promptCountBefore = h.pi.commands().filter((c) => c.type === 'prompt').length;
    // someone else (CLI) appends while we are idle
    h.files[FILE].mtimeMs = NOW + 1_000;
    await expectBridgeError(h.manager.sendPrompt('second'), 'SESSION_CONFLICT');
    expect(h.pi.commands().filter((c) => c.type === 'prompt').length).toBe(promptCountBefore);
    await h.manager.close();
  });

  it('write during OUR run is not a conflict (idle check skipped while running)', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    // slow run: respond prompt but delay settled
    setImmediate(() => {
      const cmd = h.pi.commands().filter((c) => c.type === 'prompt').pop();
      h.pi.emit({ id: cmd?.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
      h.files[FILE].mtimeMs = NOW + 500; // our own append grows the file mid-run
    });
    await h.manager.sendPrompt('first');
    // settle + refresh
    h.pi.emit({ type: 'agent_settled', aborted: false });
    await new Promise((r) => setTimeout(r, 30));
    respondToPrompt(h.pi, 'started');
    const res = await h.manager.sendPrompt('second');
    expect(res.disposition).toBe('started');
    await h.manager.close();
  });

  it('Pi rejects a prompt while streaming → RESOURCE_BUSY (no double generation)', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    setImmediate(() => {
      const cmd = h.pi.commands().filter((c) => c.type === 'prompt').pop();
      h.pi.emit({ id: cmd?.id, type: 'response', command: 'prompt', success: false, error: 'Agent is streaming: specify streamingBehavior' });
    });
    const err = await expectBridgeError(h.manager.sendPrompt('again'), 'RESOURCE_BUSY');
    expect(err.message).toMatch(/streamingBehavior/);
    await h.manager.close();
  });

  it('interrupt while closed → DISCONNECTED; while open → forwarded to abort', async () => {
    const h = makeHarness();
    await expectBridgeError(h.manager.interrupt(), 'DISCONNECTED');
    await h.manager.open(FILE);
    setImmediate(() => {
      const cmd = h.pi.commands().filter((c) => c.type === 'abort').pop();
      h.pi.emit({ id: cmd?.id, type: 'response', command: 'abort', success: true });
    });
    await expect(h.manager.interrupt()).resolves.toEqual({ interrupted: true });
    await h.manager.close();
  });
});

describe('ChatSessionManager — lifecycle events', () => {
  it('crash emits closed(DISCONNECTED), frees the slot, and allows an explicit reopen', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    h.pi.exit(7);
    await new Promise((r) => setTimeout(r, 10));
    const closed = h.events.find((e) => e.kind === 'closed');
    expect(closed).toMatchObject({ kind: 'closed', code: 'DISCONNECTED' });
    expect(h.manager.isOpen).toBe(false);
    // reopen is allowed (explicit user action — no automatic restart happened)
    const state = await h.manager.open(FILE);
    expect(state?.sessionId).toBe('s1');
    await h.manager.close();
  });

  it('user close emits closed(CANCELLED) exactly once (no duplicate from process exit)', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    await h.manager.close();
    await new Promise((r) => setTimeout(r, 20));
    const closed = h.events.filter((e) => e.kind === 'closed');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ code: 'CANCELLED' });
    expect(h.manager.isOpen).toBe(false);
  });

  it('run that never settles → fail-closed: closed(BRIDGE_TIMEOUT), slot freed, no replay', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    setImmediate(() => {
      const cmd = h.pi.commands().filter((c) => c.type === 'prompt').pop();
      h.pi.emit({ id: cmd?.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
      // …and agent_settled never arrives (settleTimeoutMs=500)
    });
    await h.manager.sendPrompt('doomed');
    await new Promise((r) => setTimeout(r, 700));
    const closed = h.events.find((e) => e.kind === 'closed');
    expect(closed).toMatchObject({ kind: 'closed', code: 'BRIDGE_TIMEOUT' });
    expect(h.manager.isOpen).toBe(false);
    expect(h.pi.commands().filter((c) => c.type === 'prompt')).toHaveLength(1); // no auto replay
  });

  it('getState returns {state:null} when closed', async () => {
    const h = makeHarness();
    expect(await h.manager.getState()).toEqual({ state: null });
  });
});
