/**
 * UI26 R01 — «Новый диалог» на официальном Pi RPC (#26).
 *
 * Проверяемое поведение (по фактам Pi 1.4.0, снятым без inference):
 *  - `pi --mode rpc` без `--session` + команда `new_session` даёт новый
 *    sessionFile, но JSONL НЕ создаётся до первой записи;
 *  - bridge никогда не пишет JSONL сам и не выдумывает сессию;
 *  - каждое событие помечено ключом `file:<sessionFile>`, чтобы поздние
 *    события одного диалога не попадали в другой;
 *  - при отмене `new_session` расширением или отсутствии файла — явная
 *    ошибка, а не «псевдосессия»;
 *  - второй writer/слот — RESOURCE_BUSY.
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
  emit: (o: unknown) => void;
  commands: () => Array<Record<string, unknown>>;
}

function makeFakePi(): FakePi {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const sent: string[] = [];
  stdin.on('data', (c: Buffer) => sent.push(c.toString('utf8')));
  const fake: FakePi = {
    killed: false,
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
    commands: () => sent.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>),
  };
  return fake;
}

const FILE = '/roots/--proj--/s.jsonl';
const NEW_FILE = '/roots/--proj--/new.jsonl';
const HEADER = `${JSON.stringify({ type: 'session', version: 3, id: 'u1', timestamp: 'T', cwd: '/home/u/proj' })}\n`;
const NOW = Date.parse('2026-10-19T12:00:00.000Z');

interface Harness {
  manager: ChatSessionManager;
  pi: FakePi;
  events: ChatEventT[];
  spawned: Array<{ args: string[]; cwd: string }>;
  /** Files that "exist on disk" — the new session file is added by a prompt. */
  existing: Set<string>;
}

function makeHarness(opts: {
  newSessionReply?: 'ok' | 'cancelled';
  stateWithoutFile?: boolean;
  onPrompt?: (pi: FakePi, cmd: Record<string, unknown>) => void;
  respondDelayMs?: number;
} = {}): Harness {
  const pi = makeFakePi();
  const events: ChatEventT[] = [];
  const spawned: Array<{ args: string[]; cwd: string }> = [];
  const existing = new Set<string>([FILE]);

  const fs = {
    async readdir() {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    async stat(p: string) {
      if (!existing.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { size: 10, mtimeMs: NOW - 60_000 };
    },
    async readHead(p: string, max: number) {
      if (!existing.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return HEADER.slice(0, max);
    },
    async readTail() {
      return '';
    },
    async readRange() {
      return Buffer.from('');
    },
  };

  // Correlated responder: answers whatever the manager asks, like real Pi.
  let sessionFile: string | null = null;
  let buf = '';
  pi.proc.stdin.on('data', (c: unknown) => {
    buf += (c as Buffer).toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim() === '') continue;
      const cmd = JSON.parse(line) as Record<string, unknown>;
      const answer = () => {
        if (cmd.type === 'get_state') {
          pi.emit({
            id: cmd.id,
            type: 'response',
            command: 'get_state',
            success: true,
            data: {
              sessionId: sessionFile ? 'new-session-id' : 'initial-id',
              ...(sessionFile && !opts.stateWithoutFile ? { sessionFile } : {}),
              isStreaming: false,
              isCompacting: false,
              messageCount: 0,
              model: null,
              thinkingLevel: 'off',
            },
          });
        } else if (cmd.type === 'new_session') {
          const cancelled = opts.newSessionReply === 'cancelled';
          if (!cancelled) sessionFile = NEW_FILE;
          pi.emit({ id: cmd.id, type: 'response', command: 'new_session', success: true, data: { cancelled } });
        } else if (cmd.type === 'switch_session') {
          sessionFile = typeof cmd.sessionPath === 'string' ? cmd.sessionPath : null;
          pi.emit({ id: cmd.id, type: 'response', command: 'switch_session', success: true, data: { cancelled: false } });
        } else if (cmd.type === 'prompt') {
          pi.emit({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
          if (opts.onPrompt) opts.onPrompt(pi, cmd);
          else if (sessionFile) existing.add(sessionFile); // Pi materializes JSONL on first write
        }
      };
      if (opts.respondDelayMs) setTimeout(answer, opts.respondDelayMs);
      else setImmediate(answer);
    }
  });

  const manager = new ChatSessionManager({
    fs: fs as never,
    home: '/home/u',
    env: {},
    now: () => NOW,
    activeWindowMs: 10_000,
    resolvePi: async () => '/fake/pi',
    spawnRpc: ({ args, cwd }) => {
      spawned.push({ args, cwd });
      return pi.proc;
    },
    onEvent: (ev) => events.push(ev),
  });

  return { manager, pi, events, spawned, existing };
}

describe('newSession — официальный Pi RPC, без фиктивного JSONL', () => {
  it('спавнит `pi --mode rpc` БЕЗ --session и отправляет команду new_session', async () => {
    const h = makeHarness();
    const { state } = await h.manager.newSession('/home/u/proj');
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0].args).toEqual(['--mode', 'rpc']);
    expect(h.spawned[0].cwd).toBe('/home/u/proj');
    expect(h.pi.commands().map((c) => c.type)).toContain('new_session');
    expect(state.sessionFile).toBe(NEW_FILE);
  });

  it('файл новой сессии не создан до первой записи (поведение Pi 1.4.0)', async () => {
    const h = makeHarness();
    await h.manager.newSession('/home/u/proj');
    expect(h.existing.has(NEW_FILE)).toBe(false);
  });

  it('события новой сессии помечены ключом file:<sessionFile>', async () => {
    const h = makeHarness();
    await h.manager.newSession('/home/u/proj');
    const opened = h.events.find((e) => e.kind === 'opened') as { key?: string } | undefined;
    expect(opened?.key).toBe(`file:${NEW_FILE}`);
  });

  it('отмена new_session (расширение Pi) — явная ошибка, процесс снят', async () => {
    const h = makeHarness({ newSessionReply: 'cancelled' });
    await expect(h.manager.newSession('/home/u/proj')).rejects.toMatchObject({ code: 'SESSION_CONFLICT' });
    expect(h.pi.killed).toBe(true);
    expect(h.manager.isOpen).toBe(false);
  });

  it('Pi не назначил sessionFile — ошибка вместо псевдосессии', async () => {
    const h = makeHarness({ stateWithoutFile: true });
    await expect(h.manager.newSession('/home/u/proj')).rejects.toMatchObject({ code: 'SESSION_CONFLICT' });
    expect(h.manager.isOpen).toBe(false);
  });

  it('второй слот — RESOURCE_BUSY, а не второй writer', async () => {
    const h = makeHarness();
    await h.manager.newSession('/home/u/proj');
    await expect(h.manager.newSession('/home/u/proj')).rejects.toBeInstanceOf(BridgeError);
    await expect(h.manager.newSession('/home/u/proj')).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    expect(h.spawned).toHaveLength(1);
  });
});

describe('sendPrompt после new_session', () => {
  it('возвращает sessionFile/sessionId и признак материализации файла', async () => {
    const h = makeHarness();
    await h.manager.newSession('/home/u/proj');
    const first = await h.manager.sendPrompt('первое сообщение');
    expect(first.disposition).toBe('started');
    expect(first.sessionFile).toBe(NEW_FILE);
    expect(first.sessionId).toBe('new-session-id');
    expect(first.materialized).toBe(true);
  });

  it('если Pi не записал файл, materialized=false (честно, без выдумки)', async () => {
    const h = makeHarness({ onPrompt: () => undefined });
    await h.manager.newSession('/home/u/proj');
    const r = await h.manager.sendPrompt('текст');
    expect(r.materialized).toBe(false);
  });

  it('после materialize события продолжают идти с тем же ключом', async () => {
    const h = makeHarness();
    await h.manager.newSession('/home/u/proj');
    await h.manager.sendPrompt('текст');
    h.pi.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
    await new Promise((r) => setTimeout(r, 20));
    const pi = h.events.filter((e) => e.kind === 'pi') as Array<{ key?: string }>;
    expect(pi.length).toBeGreaterThan(0);
    for (const e of pi) expect(e.key).toBe(`file:${NEW_FILE}`);
  });
});

describe('open — ключ сессии на событиях', () => {
  it('opened существующей сессии содержит file:<path>', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    const opened = h.events.find((e) => e.kind === 'opened') as { key?: string } | undefined;
    expect(opened?.key).toBe(`file:${FILE}`);
  });

  it('closed-событие сохраняет ключ того диалога, который закрылся', async () => {
    const h = makeHarness();
    await h.manager.open(FILE);
    await h.manager.close();
    const closed = h.events.filter((e) => e.kind === 'closed') as Array<{ key?: string }>;
    expect(closed.at(-1)?.key).toBe(`file:${FILE}`);
  });
});


/**
 * UI26 R03 — происхождение событий и single-flight слот.
 *
 * Каждый spawn получает СВОЙ фейковый процесс: только так можно проверить,
 * что позднее событие старого RPC-клиента не помечается ключом нового.
 */
function makeMultiHarness(opts: { respondDelayMs?: number } = {}) {
  const pises: FakePi[] = [];
  const events: ChatEventT[] = [];
  const spawned: Array<{ args: string[]; cwd: string }> = [];
  const existing = new Set<string>([FILE]);

  const fs = {
    async readdir() {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    async stat(p: string) {
      if (!existing.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { size: 10, mtimeMs: NOW - 60_000 };
    },
    async readHead(p: string, max: number) {
      if (!existing.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return HEADER.slice(0, max);
    },
    async readTail() {
      return '';
    },
    async readRange() {
      return Buffer.from('');
    },
  };

  const respond = (pi: FakePi, args: string[]) => {
    const sessionIdx = args.indexOf('--session');
    let sessionFile: string | null = sessionIdx >= 0 ? (args[sessionIdx + 1] ?? null) : null;
    let buf = '';
    pi.proc.stdin.on('data', (c: unknown) => {
      buf += (c as Buffer).toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim() === '') continue;
        const cmd = JSON.parse(line) as Record<string, unknown>;
        const answer = () => {
          if (cmd.type === 'get_state') {
            pi.emit({
              id: cmd.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: {
                sessionId: sessionFile ? 'sid' : 'initial',
                ...(sessionFile ? { sessionFile } : {}),
                isStreaming: false,
                isCompacting: false,
                messageCount: 0,
                model: null,
                thinkingLevel: 'off',
              },
            });
          } else if (cmd.type === 'new_session') {
            sessionFile = NEW_FILE;
            pi.emit({ id: cmd.id, type: 'response', command: 'new_session', success: true, data: { cancelled: false } });
          } else if (cmd.type === 'switch_session') {
            sessionFile = typeof cmd.sessionPath === 'string' ? cmd.sessionPath : null;
            pi.emit({ id: cmd.id, type: 'response', command: 'switch_session', success: true, data: { cancelled: false } });
          } else if (cmd.type === 'prompt') {
            pi.emit({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
            if (sessionFile) existing.add(sessionFile);
          }
        };
        if (opts.respondDelayMs) setTimeout(answer, opts.respondDelayMs);
        else setImmediate(answer);
      }
    });
  };

  const manager = new ChatSessionManager({
    fs: fs as never,
    home: '/home/u',
    env: {},
    now: () => NOW,
    activeWindowMs: 10_000,
    resolvePi: async () => '/fake/pi',
    spawnRpc: ({ args, cwd }) => {
      spawned.push({ args, cwd });
      const pi = makeFakePi();
      pises.push(pi);
      respond(pi, args);
      return pi.proc;
    },
    onEvent: (ev) => events.push(ev),
  });
  return { manager, pises, events, spawned, existing };
}

describe('UI26 R03 P1-1 — один RPC-слот (single-flight)', () => {
  it('два одновременных newSession: один spawn, второй RESOURCE_BUSY', async () => {
    const h = makeHarness({ respondDelayMs: 60 });
    const [a, b] = await Promise.allSettled([h.manager.newSession('/home/u/proj'), h.manager.newSession('/home/u/proj')]);
    expect(h.spawned).toHaveLength(1);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const bad = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    expect(ok).toHaveLength(1);
    expect((bad?.reason as { code?: string }).code).toBe('RESOURCE_BUSY');
  });

  it('одновременные open и newSession не создают второй процесс', async () => {
    const h = makeMultiHarness({ respondDelayMs: 60 });
    const [a, b] = await Promise.allSettled([h.manager.open(FILE), h.manager.newSession('/home/u/proj')]);
    expect(h.spawned).toHaveLength(1);
    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('слот освобождается после отказа Pi — следующий вызов снова работает', async () => {
    // Каждый spawn — свой процесс: после снятия упавшего клиента слот свободен.
    const h = makeMultiHarness();
    const first = h.manager.newSession('/home/u/proj');
    await expect(first).resolves.toMatchObject({ sessionFile: NEW_FILE });
    await h.manager.close();
    await expect(h.manager.newSession('/home/u/proj')).resolves.toMatchObject({ sessionFile: NEW_FILE });
    expect(h.spawned).toHaveLength(2);
  });
});

describe('UI26 R03 P1-2 — происхождение событий по RPC-поколению', () => {
  it('позднее событие закрытого A не маркируется ключом B', async () => {
    const h = makeMultiHarness();
    await h.manager.open(FILE);
    const piA = h.pises[0];
    await h.manager.close();
    await h.manager.newSession('/home/u/proj');

    // Хвост старого процесса приходит уже после открытия B.
    piA.emit({ type: 'event', name: 'tool_execution_start', data: { toolCallId: 'late-A', toolName: 'bash' } });
    piA.emit({ type: 'event', name: 'message_update', data: { assistantMessageEvent: { type: 'text_delta', delta: 'поздний A' } } });
    await new Promise((r) => setTimeout(r, 40));

    const keyedB = h.events.filter((e) => (e as { key?: string }).key === `file:${NEW_FILE}`);
    expect(JSON.stringify(keyedB)).not.toContain('late-A');
    expect(JSON.stringify(keyedB)).not.toContain('поздний A');
    // И ни одно событие не ушло без доказанного владельца.
    expect(h.events.filter((e) => !(e as { key?: string }).key)).toEqual([]);
  });

  it('события нового клиента B помечены именно B', async () => {
    const h = makeMultiHarness();
    await h.manager.open(FILE);
    await h.manager.close();
    await h.manager.newSession('/home/u/proj');
    h.pises[1].emit({ type: 'event', name: 'tool_execution_start', data: { toolCallId: 'B-1', toolName: 'bash' } });
    await new Promise((r) => setTimeout(r, 40));
    const ev = h.events.find((e) => JSON.stringify(e).includes('B-1')) as { key?: string } | undefined;
    expect(ev?.key).toBe(`file:${NEW_FILE}`);
  });
});

describe('UI26 R03 P1-4 — закрытие во время создания не оставляет процесс', () => {
  it('close() во время медленного newSession снимает слот и убивает Pi', async () => {
    const h = makeMultiHarness({ respondDelayMs: 80 });
    const pending = h.manager.newSession('/home/u/proj');
    await h.manager.close(); // до первого ACK
    await pending.catch(() => undefined);
    await h.manager.close();
    expect(h.manager.isOpen).toBe(false);
    expect(h.pises.every((p) => p.killed)).toBe(true);
  });
});

describe('UI26 R04 P2 — событие старого соединения при повторном открытии того же файла', () => {
  it('A(old) → close → A(new): позднее событие старого RPC не попадает в новую ленту', async () => {
    const h = makeMultiHarness();
    await h.manager.open(FILE); // A (old)
    const piOld = h.pises[0];
    await h.manager.close();
    await h.manager.open(FILE); // A (new) — тот же file:<path>
    const before = h.events.length;

    piOld.emit({ type: 'event', name: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'старый ответ' }] } } });
    piOld.emit({ type: 'event', name: 'tool_execution_start', data: { toolCallId: 'old-tool', toolName: 'bash' } });
    await new Promise((r) => setTimeout(r, 60));

    const fresh = h.events.slice(before);
    expect(JSON.stringify(fresh)).not.toContain('старый ответ');
    expect(JSON.stringify(fresh)).not.toContain('old-tool');
    // И событий без владельца тоже нет.
    expect(fresh.filter((e) => !(e as { key?: string }).key)).toEqual([]);
  });

  it('событие НОВОГО соединения с тем же файлом принимается', async () => {
    const h = makeMultiHarness();
    await h.manager.open(FILE);
    await h.manager.close();
    await h.manager.open(FILE);
    const before = h.events.length;
    h.pises[1].emit({ type: 'event', name: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'новый ответ' }] } } });
    await new Promise((r) => setTimeout(r, 60));
    const fresh = h.events.slice(before) as Array<{ key?: string }>;
    expect(JSON.stringify(fresh)).toContain('новый ответ');
    expect(fresh.every((e) => e.key === `file:${FILE}`)).toBe(true);
  });
});
