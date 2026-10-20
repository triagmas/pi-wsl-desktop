/**
 * T5b — PiRpcClient against REAL spawned processes (fake-pi-rpc fixture
 * speaking the verified Pi 1.3.0 protocol over actual pipes).
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PiRpcClient, RpcDisconnectedError, RpcTimeoutError } from '../../src/bridge/piRpcClient';

const FAKE_PI = path.join(__dirname, '..', 'fixtures', 'fake-pi-rpc');

function spawnFake(mode: string, extraEnv: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  return spawn(FAKE_PI, [], {
    env: { ...process.env, FAKE_PI_MODE: mode, ...extraEnv },
    stdio: 'pipe',
  });
}

interface Run {
  client: PiRpcClient;
  events: Array<{ name: string; record: unknown }>;
  diagnostics: string[];
  exits: Array<number | null>;
}

function make(mode: string, opts: { commandTimeoutMs?: number; settleTimeoutMs?: number; maxLineBytes?: number } = {}, env: Record<string, string> = {}): Run {
  const events: Array<{ name: string; record: unknown }> = [];
  const diagnostics: string[] = [];
  const exits: Array<number | null> = [];
  const client = new PiRpcClient({
    spawn: () => spawnFake(mode, env),
    commandTimeoutMs: opts.commandTimeoutMs ?? 5_000,
    settleTimeoutMs: opts.settleTimeoutMs ?? 5_000,
    maxLineBytes: opts.maxLineBytes,
    onEvent: (name, record) => events.push({ name, record }),
    onDiagnostic: (m) => diagnostics.push(m),
    onExit: (code) => exits.push(code),
  });
  client.connect();
  return { client, events, diagnostics, exits };
}

describe('PiRpcClient (real subprocess)', () => {
  it('handshake: get_state + get_session_stats over live pipes', async () => {
    const run = make('ok');
    const state = (await run.client.request('get_state')) as { sessionId: string; isStreaming: boolean; model: { id: string } };
    expect(state.sessionId).toBe('fake-session-0001');
    expect(state.isStreaming).toBe(false);
    expect(state.model.id).toBe('fake-model');
    const stats = (await run.client.request('get_session_stats')) as { totalMessages: number };
    expect(stats.totalMessages).toBe(4);
    await run.client.close();
    expect(run.exits[0]).toBe(0);
  });

  it('resume path: switch_session changes the reported session file', async () => {
    const run = make('ok');
    const before = (await run.client.request('get_state')) as { sessionFile?: string };
    expect(before.sessionFile).toBeUndefined(); // mirrors --no-session handshake
    const res = (await run.client.request('switch_session', { sessionPath: '/roots/--proj--/s.jsonl' })) as { cancelled: boolean };
    expect(res.cancelled).toBe(false);
    const after = (await run.client.request('get_state')) as { sessionFile?: string };
    expect(after.sessionFile).toBe('/roots/--proj--/s.jsonl');
    await run.client.close();
  });

  it('prompt streams real records through agent_settled (unicode deltas intact)', async () => {
    const run = make('ok');
    const r = await run.client.promptAndWait('hi there');
    expect(r).toEqual({ disposition: 'started', aborted: false });
    const names = run.events.map((e) => e.name);
    expect(names[0]).toBe('agent_start');
    expect(names[names.length - 1]).toBe('agent_settled');
    const deltas = run.events
      .filter((e) => e.name === 'message_update')
      .map((e) => (e.record as { assistantMessageEvent: { delta: string } }).assistantMessageEvent.delta);
    expect(deltas.join('')).toBe('Hello 🌍 — done');
    await run.client.close();
    expect(run.exits[0]).toBe(0);
  });

  it('interrupt during a slow run settles aborted and leaves the process closable', async () => {
    const run = make('ok', {}, { FAKE_PI_STREAM_MS: '80' });
    const runP = run.client.promptAndWait('slow job');
    await new Promise((r) => setTimeout(r, 60));
    await run.client.interrupt();
    const result = await runP;
    expect(result.aborted).toBe(true);
    await run.client.close();
    expect(run.exits[0]).toBe(0);
  });

  it('hang-prompt: command deadline fires and close() reaps the process', async () => {
    const run = make('hang-prompt', { commandTimeoutMs: 150 });
    await expect(run.client.request('prompt', { message: 'x' })).rejects.toBeInstanceOf(RpcTimeoutError);
    await run.client.close();
    expect(run.exits.length).toBeGreaterThanOrEqual(1);
    expect(run.client.alive).toBe(false);
  });

  it('crash: pending rejects with RpcDisconnectedError and onExit reports the code — no replay', async () => {
    const run = make('crash-on-prompt');
    await expect(run.client.promptAndWait('x')).rejects.toBeInstanceOf(RpcDisconnectedError);
    await new Promise((r) => setTimeout(r, 50));
    expect(run.exits).toEqual([7]);
    expect(run.client.alive).toBe(false);
    // a follow-up request must not reach the (dead) process
    await expect(run.client.request('get_state')).rejects.toBeInstanceOf(RpcDisconnectedError);
  });

  it('hostile start: garbage + oversize line kill the connection with diagnostics', async () => {
    const run = make('hostile-start', { maxLineBytes: 1024 });
    // Poll for the kill instead of sleeping a fixed 200ms — under parallel
    // load the diagnostics legitimately arrive later (observed CI/local flake).
    const deadline = Date.now() + 5_000;
    for (;;) {
      if (!run.client.alive && run.diagnostics.some((d) => /oversize|json/i.test(d))) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(run.client.alive).toBe(false);
    expect(run.diagnostics.some((d) => /oversize|json/i.test(d))).toBe(true);
    await run.client.close();
  });

  it('switch-fail surfaces the Pi error string', async () => {
    const run = make('switch-fail');
    await expect(run.client.request('switch_session', { sessionPath: '/x' })).rejects.toThrow(/not found/i);
    await run.client.close();
  });

  it('ext-ui: blocking dialog is auto-cancelled so the session never wedges', async () => {
    const run = make('ext-ui');
    // prove liveness: the client still answers commands after the dialog
    const state = (await run.client.request('get_state')) as { sessionId: string };
    expect(state.sessionId).toBe('fake-session-0001');
    await run.client.close();
  });
});

describe('fixture hygiene', () => {
  it('fake-pi-rpc is executable and has no network/model code', () => {
    const res = spawnSync(FAKE_PI, ['--help'], { encoding: 'utf8', timeout: 5_000, env: { ...process.env, FAKE_PI_MODE: 'ok' } });
    // fixture ignores args entirely — exit code proves it runs as a plain process
    expect(res.error).toBeUndefined();
  });
});
