/**
 * UI-B R01 — TerminalManager (main): процессный контракт.
 *
 * Проверяем то, что важно для безопасности и жизни терминала:
 * argv собирается массивом (никакой shell-строки), входные данные валидируются,
 * кадры помощника превращаются в типизированные события, resize клэмпится,
 * закрытие завершает ТОЛЬКО свою сессию, потеря процесса отмечается честно.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TerminalManager } from '../../src/main/terminal';
import type { TerminalEvent } from '../../src/shared/terminal';
import { TerminalError } from '../../src/shared/terminal';
import { PTY_HELPER_B64, PYTHON_RUNNER } from '../../src/main/ptyHelper';

class FakeChild extends EventEmitter {
  pid = 4242;
  written: string[] = [];
  killed = false;
  stdin = {
    write: (chunk: string) => {
      this.written.push(chunk);
      return true;
    },
    end: vi.fn(),
    on: vi.fn(),
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  });
  emitFrame(frame: unknown) {
    this.stdout.emit('data', `${JSON.stringify(frame)}\n`);
  }
  emitRaw(text: string) {
    this.stdout.emit('data', text);
  }
}

function harness(options: { maxSessions?: number } = {}) {
  const children: FakeChild[] = [];
  const events: TerminalEvent[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const manager = new TerminalManager({
    spawn: spawn as never,
    onEvent: (event) => events.push(event),
    killGraceMs: 5,
    ...options,
  });
  return { manager, children, events, spawn };
}

const OPEN = { distro: 'Ubuntu', cwd: '/home/u/proj', cols: 100, rows: 30 };

describe('TerminalManager: открытие сессии', () => {
  it('spawns wsl.exe with an argv array (no shell string) and the distro/cwd', () => {
    const { manager, spawn } = harness();
    const handle = manager.open(OPEN);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { stdio: string[] }];
    expect(cmd).toContain('wsl');
    expect(args).toEqual([
      '-d',
      'Ubuntu',
      '--exec',
      'python3',
      '-u',
      '-c',
      PYTHON_RUNNER,
      PTY_HELPER_B64,
      '100',
      '30',
      '/home/u/proj',
      '/bin/bash',
    ]);
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(handle).toMatchObject({ distro: 'Ubuntu', cwd: '/home/u/proj', cols: 100, rows: 30, pid: null });
    expect(manager.size()).toBe(1);
  });

  it('clamps requested sizes before they reach the helper', () => {
    const { manager, spawn } = harness();
    manager.open({ ...OPEN, cols: 99_999, rows: 0 });
    const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1];
    // argv: … -c RUNNER B64 <cols> <rows> <cwd> <shell>
    expect(args[8]).toBe('400');
    expect(args[9]).toBe('1');
  });

  it('rejects unsafe distro/cwd instead of passing them to wsl.exe', () => {
    const { manager, spawn } = harness();
    expect(() => manager.open({ ...OPEN, distro: 'Ubuntu; rm -rf /' })).toThrow(TerminalError);
    expect(() => manager.open({ ...OPEN, distro: '' })).toThrow(TerminalError);
    expect(() => manager.open({ ...OPEN, cwd: 'relative/path' })).toThrow(TerminalError);
    expect(spawn).not.toHaveBeenCalled();
    try {
      manager.open({ ...OPEN, cwd: '/tmp/a\nb' });
    } catch (err) {
      expect((err as TerminalError).code).toBe('TERMINAL_BAD_CWD');
    }
  });

  it('opens in the distro home directory when there is no project', () => {
    const { manager, spawn } = harness();
    const handle = manager.open({ ...OPEN, cwd: '' });
    const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args[10]).toBe('');
    expect(handle.cwd).toBe('');
  });

  it('enforces the session limit', () => {
    const { manager } = harness({ maxSessions: 2 });
    manager.open(OPEN);
    manager.open(OPEN);
    expect(() => manager.open(OPEN)).toThrow(TerminalError);
    try {
      manager.open(OPEN);
    } catch (err) {
      expect((err as TerminalError).code).toBe('TERMINAL_LIMIT');
    }
  });

  it('maps spawn failure to an honest exit event and drops the session', () => {
    const children: FakeChild[] = [];
    const events: TerminalEvent[] = [];
    const manager = new TerminalManager({
      spawn: (() => {
        const child = new FakeChild();
        children.push(child);
        setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
        return child;
      }) as never,
      onEvent: (event) => events.push(event),
      killGraceMs: 5,
    });
    const handle = manager.open(OPEN);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const exit = events.find((e) => e.type === 'exit');
        expect(exit).toMatchObject({ id: handle.id, lost: true });
        expect(String(exit && 'message' in exit ? exit.message : '')).toContain('TERMINAL_UNAVAILABLE');
        expect(manager.size()).toBe(0);
        resolve();
      }, 10);
    });
  });
});

describe('TerminalManager: кадры и ввод', () => {
  it('forwards ready/data/notice frames as typed events after attach', () => {
    const { manager, children, events } = harness();
    const handle = manager.open(OPEN);
    const child = children[0];
    manager.attach(handle.id);
    child.emitFrame({ t: 'ready', pid: 777, cwd: '/home/u/proj' });
    child.emitFrame({ t: 'out', d: Buffer.from('hi\n').toString('base64') });
    child.emitFrame({ t: 'notice', code: 'CWD_FALLBACK', message: 'открыт домашний каталог' });
    expect(events).toEqual([
      { type: 'ready', id: handle.id, pid: 777, cwd: '/home/u/proj' },
      { type: 'data', id: handle.id, b64: Buffer.from('hi\n').toString('base64') },
      { type: 'notice', id: handle.id, code: 'CWD_FALLBACK', message: 'открыт домашний каталог' },
    ]);
    expect(manager.sessions()[0]?.pid).toBe(777);
  });

  it('writes base64 input and rejects malformed payloads', () => {
    const { manager, children } = harness();
    const handle = manager.open(OPEN);
    const child = children[0];
    expect(manager.write(handle.id, Buffer.from('ls\n').toString('base64'))).toBe(true);
    expect(JSON.parse(child.written[0] ?? '{}')).toEqual({ t: 'in', d: Buffer.from('ls\n').toString('base64') });
    expect(manager.write(handle.id, 'not base64!!')).toBe(false);
    expect(manager.write('missing', Buffer.from('x').toString('base64'))).toBe(false);
    expect(child.written).toHaveLength(1);
  });

  it('clamps resize frames before sending them', () => {
    const { manager, children } = harness();
    const handle = manager.open(OPEN);
    manager.resize(handle.id, 10_000, -5);
    const frame = JSON.parse(children[0].written[0] ?? '{}');
    expect(frame).toEqual({ t: 'resize', c: 400, r: 1 });
    expect(manager.sessions()[0]).toMatchObject({ cols: 400, rows: 1 });
  });

  it('closes only the requested session and reports a clean exit once', () => {
    const { manager, children, events } = harness();
    const a = manager.open(OPEN);
    const b = manager.open({ ...OPEN, cwd: '/home/u/other' });
    manager.close(a.id);
    expect(JSON.parse(children[0].written[0] ?? '{}')).toEqual({ t: 'close' });
    expect(children[1].written).toHaveLength(0);
    children[0].emitFrame({ t: 'exit', code: 0 });
    children[0].emit('exit', 0, null);
    const exits = events.filter((e) => e.type === 'exit');
    expect(exits).toEqual([{ type: 'exit', id: a.id, code: 0, lost: false }]);
    expect(manager.size()).toBe(1);
    expect(manager.sessions().map((s) => s.id)).toEqual([b.id]);
  });

  it('marks an unexpected process death as lost', () => {
    const { manager, children, events } = harness();
    const handle = manager.open(OPEN);
    children[0].emit('exit', 1, null);
    const exit = events.find((e) => e.type === 'exit');
    expect(exit).toMatchObject({ id: handle.id, lost: true });
    expect(manager.size()).toBe(0);
  });

  it('kills the helper after the grace period when it ignores close', async () => {
    const { manager, children } = harness();
    const handle = manager.open(OPEN);
    manager.close(handle.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(children[0].kill).toHaveBeenCalled();
  });

  it('fails the session on an oversized frame instead of buffering forever', () => {
    const { manager, children, events } = harness();
    const handle = manager.open(OPEN);
    children[0].emitRaw('x'.repeat(1024 * 1024 + 10));
    const exit = events.find((e) => e.type === 'exit');
    expect(exit).toMatchObject({ id: handle.id, lost: true });
    expect(String(exit && 'message' in exit ? exit.message : '')).toContain('TERMINAL_PROTOCOL');
    expect(manager.size()).toBe(0);
  });

  it('disposeAll closes every session (app quit does not touch WSL globally)', () => {
    const { manager, children } = harness();
    manager.open(OPEN);
    manager.open(OPEN);
    manager.disposeAll();
    expect(children.map((c) => c.written.some((w) => w.includes('"close"')))).toEqual([true, true]);
    expect(manager.size()).toBe(0);
  });
});

/**
 * Границы, которые нельзя проверять глазами: освобождение ресурсов при
 * закрытии и адресность команд по id. Здесь же — «док скрыт, процесс жив».
 */
describe('TerminalManager: завершение процессов и адресность', () => {
  it('close() sends the close frame AND ends stdin so the helper frees the PTY itself', () => {
    const { manager, children } = harness();
    const handle = manager.open(OPEN);
    manager.close(handle.id);
    expect(children[0].written.some((w) => w.includes('"close"'))).toBe(true);
    expect(children[0].stdin.end).toHaveBeenCalledTimes(1);
  });

  it('disposeAll() ends stdin for every session before killing it', () => {
    const { manager, children } = harness();
    manager.open(OPEN);
    manager.open(OPEN);
    manager.disposeAll();
    expect(children.map((c) => c.stdin.end.mock.calls.length)).toEqual([1, 1]);
    expect(children.every((c) => c.killed)).toBe(true);
  });

  it('close()/write()/resize() ignore an unknown or foreign session id', () => {
    const { manager, children } = harness();
    const first = manager.open(OPEN);
    const second = manager.open(OPEN);
    const before = children.map((c) => c.written.length);
    expect(manager.write('нет-такой', 'YQ==')).toBe(false);
    manager.resize('нет-такой', 10, 10);
    manager.close('нет-такой');
    manager.close('');
    expect(children.map((c) => c.written.length)).toEqual(before);
    // закрытие одной сессии не трогает вторую
    manager.close(first.id);
    expect(children[0].written.some((w) => w.includes('"close"'))).toBe(true);
    expect(children[1].written.some((w) => w.includes('"close"'))).toBe(false);
    expect(manager.sessions().map((s) => s.id)).toContain(second.id);
  });

  it('keeps the process alive while the dock is hidden and closes it only on request', () => {
    const { manager, children } = harness();
    const handle = manager.open(OPEN);
    // скрытие дока в UI не вызывает ни close, ни kill
    expect(children[0].killed).toBe(false);
    expect(children[0].stdin.end).not.toHaveBeenCalled();
    // процесс продолжает принимать ввод после «скрытия»
    expect(manager.write(handle.id, 'bHM=')).toBe(true);
    expect(children[0].written.some((w) => w.includes('"in"'))).toBe(true);
    manager.close(handle.id);
    expect(children[0].stdin.end).toHaveBeenCalledTimes(1);
  });
});

/**
 * Гонка старта PTY: процесс печатает приглашение раньше, чем renderer
 * подписался на события. Ранние кадры нельзя терять — до `attach` они
 * копятся в main, после attach отдаются по порядку.
 */
describe('TerminalManager: ранние события до attach', () => {
  it('does not drop frames emitted before the renderer attaches', () => {
    const { manager, children, events } = harness();
    const handle = manager.open(OPEN);
    const child = children[0];
    child.emitFrame({ t: 'ready', pid: 4242, cwd: '/home/u/p' });
    child.emitFrame({ t: 'out', d: Buffer.from('prompt$ ').toString('base64') });
    expect(events, 'до подписки события не отправляются').toEqual([]);

    expect(manager.attach(handle.id)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['ready', 'data']);
    expect(events[1]).toMatchObject({ b64: Buffer.from('prompt$ ').toString('base64') });
  });

  it('streams immediately after attach and never replays twice', () => {
    const { manager, children, events } = harness();
    const handle = manager.open(OPEN);
    manager.attach(handle.id);
    manager.attach(handle.id); // повторная подписка — no-op
    children[0].emitFrame({ t: 'out', d: Buffer.from('a').toString('base64') });
    expect(events).toHaveLength(1);
    expect(manager.attach('нет-такой')).toBe(false);
  });

  it('keeps the newest output when the early backlog overflows', () => {
    const children: FakeChild[] = [];
    const events: TerminalEvent[] = [];
    const manager = new TerminalManager({
      spawn: (() => {
        const child = new FakeChild();
        children.push(child);
        return child;
      }) as never,
      onEvent: (event) => events.push(event),
      killGraceMs: 5,
      backlogBytes: 100,
    });
    const handle = manager.open(OPEN);
    const frame = (text: string) => Buffer.from(text).toString('base64');
    children[0].emitFrame({ t: 'out', d: frame('A'.repeat(80)) });
    children[0].emitFrame({ t: 'out', d: frame('B'.repeat(80)) });
    children[0].emitFrame({ t: 'out', d: frame('C'.repeat(80)) });
    manager.attach(handle.id);
    const text = events
      .filter((e) => e.type === 'data')
      .map((e) => Buffer.from(e.b64, 'base64').toString('utf8'))
      .join('');
    expect(text).toContain('C');
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it('returns false for a session that ended before attach (no silent empty terminal)', () => {
    const { manager, children } = harness();
    const handle = manager.open(OPEN);
    children[0].emitFrame({ t: 'exit', code: 0 });
    expect(manager.attach(handle.id)).toBe(false);
  });
});
