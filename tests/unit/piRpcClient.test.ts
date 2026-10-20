/**
 * RED gate T5a — PiRpcClient over an injected process.
 * Verified against installed Pi 1.3.0 docs (rpc.md / rpc-commands.md / json.md):
 * id correlation, LF framing, subscribe-before-prompt, disposition semantics,
 * agent_settled as the only run terminal, abort, timeouts, crash handling,
 * extension UI subprotocol, and NO silent replay after disconnect.
 */
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PiRpcClient, RpcCommandError, RpcTimeoutError, RpcDisconnectedError } from '../../src/bridge/piRpcClient';

interface FakeProc {
  instance: {
    stdin: PassThrough;
    stdout: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => void;
    on: (ev: string, cb: (...args: unknown[]) => void) => unknown;
  };
  writes: string[];
  killed: boolean;
  emit: (obj: unknown) => void;
  raw: (s: string) => void;
  exit: (code: number | null) => void;
}

function makeFakeProc(): FakeProc {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const writes: string[] = [];
  stdin.on('data', (c: Buffer) => writes.push(c.toString('utf8')));
  const proc = {
    stdin,
    stdout,
    killed: false,
    kill: (_signal?: NodeJS.Signals | number) => {
      proc.killed = true;
      emitter.emit('exit', null, 'SIGKILL');
    },
    on: (ev: string, cb: (...args: unknown[]) => void) => emitter.on(ev, cb),
  };
  return {
    get instance() {
      return proc as unknown as FakeProc['instance'];
    },
    writes,
    get killed() {
      return proc.killed;
    },
    emit: (obj) => stdout.write(`${JSON.stringify(obj)}\n`),
    raw: (s) => stdout.write(s),
    exit: (code) => emitter.emit('exit', code, null),
  };
}

function makeClient(
  fake: FakeProc,
  opts: { commandTimeoutMs?: number; settleTimeoutMs?: number; exitWaitMs?: number } = {},
) {
  const events: Array<{ name: string; record: unknown }> = [];
  const diagnostics: string[] = [];
  const exits: Array<number | null> = [];
  const client = new PiRpcClient({
    spawn: () => fake.instance,
    commandTimeoutMs: opts.commandTimeoutMs ?? 2000,
    settleTimeoutMs: opts.settleTimeoutMs ?? 2000,
    exitWaitMs: opts.exitWaitMs ?? 50,
    onEvent: (name, record) => events.push({ name, record }),
    onDiagnostic: (m) => diagnostics.push(m),
    onExit: (code) => exits.push(code),
  });
  client.connect();
  return { client, events, diagnostics, exits };
}

/** Respond to the next stdin command line the client writes. */
function respondToNext(fake: FakeProc, build: (cmd: { id?: string; type: string }) => unknown): void {
  // Wait a microtask+tick so the client's write lands in `writes`.
  setImmediate(() => {
    const line = fake.writes[fake.writes.length - 1];
    const cmd = JSON.parse(line) as { id?: string; type: string };
    fake.emit(build(cmd));
  });
}

/** Respond to EVERY command line (for tests issuing several requests). */
function autoRespond(fake: FakeProc, build: (cmd: { id?: string; type: string }) => unknown): void {
  let buf = '';
  fake.instance.stdin.on('data', (c: unknown) => {
    buf += (c as Buffer).toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim() !== '') setImmediate(() => fake.emit(build(JSON.parse(line))));
    }
  });
}

describe('PiRpcClient — request/response correlation', () => {
  it('correlates out-of-order responses by id', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake);
    const p1 = client.request('get_state');
    const p2 = client.request('get_session_stats');
    setImmediate(() => {
      const lines = fake.writes.join('').trim().split('\n').map((l) => JSON.parse(l) as { id: string; type: string });
      const [c1, c2] = lines;
      fake.emit({ id: c2.id, type: 'response', command: c2.type, success: true, data: { n: 2 } });
      fake.emit({ id: c1.id, type: 'response', command: c1.type, success: true, data: { n: 1 } });
    });
    await expect(p1).resolves.toEqual({ n: 1 });
    await expect(p2).resolves.toEqual({ n: 2 });
  });

  it('rejects with the Pi error string on success:false', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake);
    autoRespond(fake, (cmd) => ({
      id: cmd.id,
      type: 'response',
      command: cmd.type,
      success: false,
      error: 'Model not found: invalid/model',
    }));
    await expect(client.request('set_model')).rejects.toBeInstanceOf(RpcCommandError);
    await expect(client.request('set_model')).rejects.toThrow(/Model not found/);
  });

  it('times out without a response and ignores the late arrival', async () => {
    const fake = makeFakeProc();
    const { client, diagnostics } = makeClient(fake, { commandTimeoutMs: 40 });
    const p = client.request('get_state');
    await expect(p).rejects.toBeInstanceOf(RpcTimeoutError);
    // late response must not throw anywhere
    fake.emit({ id: JSON.parse(fake.writes[0]).id, type: 'response', command: 'get_state', success: true, data: {} });
    await new Promise((r) => setImmediate(r));
    expect(diagnostics.some((d) => /late/i.test(d))).toBe(true);
  });

  it('rejects all pending work when the process exits (no auto-restart, no replay)', async () => {
    const fake = makeFakeProc();
    const { client, exits } = makeClient(fake);
    const p = client.request('get_state');
    fake.exit(1);
    await expect(p).rejects.toBeInstanceOf(RpcDisconnectedError);
    expect(exits).toEqual([1]);
    // a request after disconnect must reject WITHOUT writing anything new
    const before = fake.writes.length;
    await expect(client.request('get_state')).rejects.toBeInstanceOf(RpcDisconnectedError);
    expect(fake.writes.length).toBe(before);
  });
});

describe('PiRpcClient — events, framing, hostile streams', () => {
  it('forwards session events to onEvent and keeps running across parse garbage', async () => {
    const fake = makeFakeProc();
    const { client, events, diagnostics } = makeClient(fake);
    fake.emit({ type: 'agent_start' });
    fake.raw('this is not json\n');
    fake.emit({ type: 'agent_settled', aborted: false });
    await new Promise((r) => setImmediate(r));
    expect(events.map((e) => e.name)).toEqual(['agent_start', 'agent_settled']);
    expect(diagnostics.some((d) => /json/i.test(d))).toBe(true);
    expect(client.alive).toBe(true);
  });

  it('does not split on U+2028/U+2029 inside JSON strings', async () => {
    const fake = makeFakeProc();
    const { events } = makeClient(fake);
    fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a b c' } });
    await new Promise((r) => setImmediate(r));
    expect(events).toHaveLength(1);
    const rec = events[0].record as { assistantMessageEvent: { delta: string } };
    expect(rec.assistantMessageEvent.delta).toBe('a b c');
  });

  it('an oversize stdout line kills the connection instead of buffering unbounded', async () => {
    const fake = makeFakeProc();
    const { client, exits } = makeClient(fake);
    const { PiRpcClient: C } = await import('../../src/bridge/piRpcClient');
    expect(typeof C).toBe('function');
    // rebuild with tiny cap
    const tiny = makeFakeProc();
    const diag2: string[] = [];
    const exits2: Array<number | null> = [];
    const c2 = new PiRpcClient({
      spawn: () => tiny.instance,
      maxLineBytes: 64,
      onDiagnostic: (m) => diag2.push(m),
      onExit: (c) => exits2.push(c),
    });
    c2.connect();
    tiny.raw(`{"type":"noise","pad":"${'x'.repeat(500)}"}\n`);
    await new Promise((r) => setImmediate(r));
    expect(tiny.killed).toBe(true);
    expect(diag2.some((d) => /oversize|too large|exceeds/i.test(d))).toBe(true);
    expect(c2.alive).toBe(false);
    // sanity: default client untouched
    expect(client.alive).toBe(true);
    expect(exits).toEqual([]);
  });
});

describe('PiRpcClient — extension UI subprotocol', () => {
  it('ignores fire-and-forget requests but auto-cancels blocking dialogs (never hangs)', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake);
    fake.emit({ type: 'extension_ui_request', id: 'u1', method: 'notify', message: 'hi' });
    fake.emit({ type: 'extension_ui_request', id: 'u2', method: 'confirm', title: 'Sure?' });
    await new Promise((r) => setImmediate(r));
    const written = fake.writes.join('');
    expect(written).not.toContain('notify'); // fire-and-forget: no response
    expect(written).toContain('extension_ui_response');
    expect(written).toContain('"cancelled":true');
    expect(client.alive).toBe(true);
  });

  it('a custom onExtensionUi handler can answer dialogs itself', async () => {
    const fake = makeFakeProc();
    const seen: string[] = [];
    const client = new PiRpcClient({
      spawn: () => fake.instance,
      onExtensionUi: (req, respond) => {
        seen.push(req.method as string);
        respond({ type: 'extension_ui_response', id: req.id, confirmed: true });
      },
    });
    client.connect();
    fake.emit({ type: 'extension_ui_request', id: 'u9', method: 'confirm', title: 'x' });
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual(['confirm']);
    expect(fake.writes.join('')).toContain('"confirmed":true');
  });
});

describe('PiRpcClient — prompt lifecycle', () => {
  it('prompt handled ⇒ resolves without waiting for agent_settled', async () => {
    const fake = makeFakeProc();
    const { client, events } = makeClient(fake);
    respondToNext(fake, (cmd) => ({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: { disposition: 'handled' } }));
    const r = await client.promptAndWait('/skill:thing');
    expect(r).toEqual({ disposition: 'handled', aborted: false });
    expect(events).toHaveLength(0);
  });

  it('prompt started ⇒ streams events until agent_settled (epoch-safe against early settle)', async () => {
    const fake = makeFakeProc();
    const { client, events } = makeClient(fake);
    setImmediate(() => {
      const cmd = JSON.parse(fake.writes[0]) as { id: string; type: string };
      // settled arrives BEFORE the prompt response (fast completion race)
      fake.emit({ type: 'agent_start' });
      fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hi' } });
      fake.emit({ type: 'agent_settled', aborted: false });
      fake.emit({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: { disposition: 'started' } });
    });
    const r = await client.promptAndWait('hello');
    expect(r).toEqual({ disposition: 'started', aborted: false });
    expect(events.map((e) => e.name)).toEqual(['agent_start', 'message_update', 'agent_settled']);
  });

  it('rejects a prompt when Pi reports success:false', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake);
    respondToNext(fake, (cmd) => ({
      id: cmd.id,
      type: 'response',
      command: cmd.type,
      success: false,
      error: 'Agent is streaming: specify streamingBehavior',
    }));
    await expect(client.promptAndWait('x')).rejects.toThrow(/streamingBehavior/);
  });

  it('fails promptAndWait when agent_settled never arrives (bounded settle wait)', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake, { settleTimeoutMs: 40 });
    respondToNext(fake, (cmd) => ({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: { disposition: 'started' } }));
    await expect(client.promptAndWait('x')).rejects.toBeInstanceOf(RpcTimeoutError);
  });

  it('interrupt() sends abort, resolves after the idle response, and settles an active run', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake);
    setImmediate(() => {
      const cmd = JSON.parse(fake.writes[0]) as { id: string; type: string };
      fake.emit({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: { disposition: 'started' } });
      fake.emit({ type: 'agent_start' });
    });
    const run = client.promptAndWait('long job');
    await new Promise((r) => setTimeout(r, 10));
    const interrupt = client.interrupt();
    setImmediate(() => {
      // pi: settled(aborted) fires, THEN abort responds (it waits for idle)
      const abortCmd = fake.writes.map((w) => JSON.parse(w) as { type: string }).find((c) => c.type === 'abort')!;
      expect(abortCmd).toBeTruthy();
      fake.emit({ type: 'agent_settled', aborted: true });
      fake.emit({ type: 'response', command: 'abort', success: true });
    });
    await expect(interrupt).resolves.toBeUndefined();
    await expect(run).resolves.toEqual({ disposition: 'started', aborted: true });
  });
});

describe('PiRpcClient — shutdown', () => {
  it('close() ends stdin and waits for a graceful exit', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake, { exitWaitMs: 200 });
    fake.instance.stdin.on('end', () => fake.exit(0));
    await client.close();
    expect(fake.killed).toBe(false);
    expect(client.alive).toBe(false);
  });

  it('close() force-kills a process that ignores stdin EOF', async () => {
    const fake = makeFakeProc();
    const { client } = makeClient(fake, { exitWaitMs: 40 });
    await client.close();
    expect(fake.killed).toBe(true);
    expect(client.alive).toBe(false);
  });
});
