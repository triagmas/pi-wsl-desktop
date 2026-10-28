/**
 * UI21 F1-B R02 (P1) — бюджет ACK команды `prompt` в PiRpcClient.
 *
 * `startPrompt` возвращается, как только Pi ПРИНЯЛ промпт (`disposition`);
 * стриминг идёт дальше событиями. Поэтому тайм-аут здесь — это бюджет ACK,
 * а не длительности ответа модели. Холодная сессия (первый промпт, загрузка
 * провайдера/расширений) подтверждает приём дольше 10 с, поэтому бюджет
 * должен быть заметно больше и НЕ равен общему тайм-ауту обычных команд.
 *
 * RED: до правки `prompt` шёл с общим `commandTimeoutMs` (15 000 мс), и ACK
 * на 20-й секунде превращался в `RpcTimeoutError` → `BRIDGE_TIMEOUT`.
 */
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiRpcClient, type RpcProcess } from '../../src/bridge/piRpcClient';
import { PI_PROMPT_ACK_TIMEOUT_MS } from '../../src/shared/timeouts';

interface FakePi {
  proc: RpcProcess;
  commands: () => Array<Record<string, unknown>>;
  emit: (frame: unknown) => void;
}

function makeFakePi(): FakePi {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const sent: string[] = [];
  stdin.on('data', (c: Buffer) => sent.push(c.toString('utf8')));
  const proc = {
    stdin,
    stdout,
    kill: () => emitter.emit('exit', null, 'SIGKILL'),
    on: (ev: string, cb: (...args: unknown[]) => void) => emitter.on(ev, cb),
  } as unknown as RpcProcess;
  return {
    proc,
    commands: () => sent.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>),
    emit: (frame: unknown) => stdout.write(`${JSON.stringify(frame)}\n`),
  };
}

function makeClient() {
  const pi = makeFakePi();
  const client = new PiRpcClient({ spawn: () => pi.proc });
  client.connect();
  return { client, pi };
}

const promptCommand = (pi: FakePi) => pi.commands().filter((c) => c.type === 'prompt').pop()!;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PiRpcClient — бюджет ACK промпта', () => {
  it('быстрый ACK (2 с) принимается, disposition прокидывается', async () => {
    const { client, pi } = makeClient();
    const pending = client.startPrompt('hello');
    await vi.advanceTimersByTimeAsync(2_000);
    const cmd = promptCommand(pi);
    expect(cmd.message).toBe('hello');
    pi.emit({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    await expect(pending).resolves.toMatchObject({ disposition: 'started' });
  });

  it('задержанный ACK (20 с) НЕ становится BRIDGE_TIMEOUT', async () => {
    const { client, pi } = makeClient();
    const pending = client.startPrompt('cold session');
    await vi.advanceTimersByTimeAsync(20_000);
    const cmd = promptCommand(pi);
    pi.emit({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    await expect(pending).resolves.toMatchObject({ disposition: 'started' });
  });

  it('ACK на границе бюджета (60 с) ещё принимается', async () => {
    const { client, pi } = makeClient();
    const pending = client.startPrompt('slow provider init');
    await vi.advanceTimersByTimeAsync(PI_PROMPT_ACK_TIMEOUT_MS - 500);
    const cmd = promptCommand(pi);
    pi.emit({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    await expect(pending).resolves.toMatchObject({ disposition: 'started' });
  });

  it('отсутствие ACK дольше бюджета даёт RpcTimeoutError с бюджетом ACK', async () => {
    const { client } = makeClient();
    const pending = client.startPrompt('no ack');
    const assertion = expect(pending).rejects.toThrow(new RegExp(`${PI_PROMPT_ACK_TIMEOUT_MS}ms`));
    await vi.advanceTimersByTimeAsync(PI_PROMPT_ACK_TIMEOUT_MS + 100);
    await assertion;
  });

  it('обычные команды не получают увеличенный бюджет ACK', async () => {
    const { client } = makeClient();
    const state = client.request('get_state');
    const assertion = expect(state).rejects.toThrow(/get_state" timed out after 15000ms/);
    await vi.advanceTimersByTimeAsync(15_100);
    await assertion;
  });
});
