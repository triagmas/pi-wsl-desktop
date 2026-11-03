/**
 * UI-B R01 — IPC терминала и метрик (main). Каналы фиксированные и
 * типизированные; при отсутствии хоста (unit/test) они не регистрируются
 * вовсе — fail closed, renderer не получает доступ к произвольному shell.
 */
import { describe, expect, it, vi } from 'vitest';
import { registerIpc, type IpcLike } from '../../src/main/ipc';

function harness(options: Parameters<typeof registerIpc>[3] = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcLike = { handle: (channel, fn) => void handlers.set(channel, fn) };
  const conn = {
    request: vi.fn(async () => ({ ok: true })),
    snapshot: vi.fn(() => ({ phase: 'ready' })),
    retry: vi.fn(() => ({ phase: 'discovering' })),
    listDistros: vi.fn(async () => ['Ubuntu']),
    selectDistro: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeChat: vi.fn(() => () => undefined),
  };
  const sent: Array<{ channel: string; payload: unknown }> = [];
  registerIpc(ipc, conn as never, (channel, payload) => sent.push({ channel, payload }), options);
  return { handlers, conn, sent };
}

function terminalHost() {
  return {
    open: vi.fn(() => ({ id: 't1', distro: 'Ubuntu', cwd: '/home/u/p', cols: 80, rows: 24, pid: null })),
    attach: vi.fn(() => true),
    write: vi.fn(() => true),
    resize: vi.fn(),
    close: vi.fn(),
  };
}

describe('terminal IPC (fail closed)', () => {
  it('registers no terminal or metrics channels when no host is provided', () => {
    const { handlers } = harness();
    expect(handlers.has('terminal:open')).toBe(false);
    expect(handlers.has('terminal:attach')).toBe(false);
    expect(handlers.has('terminal:write')).toBe(false);
    expect(handlers.has('terminal:resize')).toBe(false);
    expect(handlers.has('terminal:close')).toBe(false);
    expect(handlers.has('metrics:get')).toBe(false);
  });

  it('opens a session through the host and returns its handle', async () => {
    const host = terminalHost();
    const { handlers } = harness({ terminal: host });
    const result = await handlers.get('terminal:open')!(null, {
      distro: 'Ubuntu',
      cwd: '/home/u/p',
      cols: 80,
      rows: 24,
    });
    expect(host.open).toHaveBeenCalledWith({ distro: 'Ubuntu', cwd: '/home/u/p', cols: 80, rows: 24 });
    expect(result).toMatchObject({ id: 't1' });
  });

  it('rejects malformed open/write/resize payloads before touching the host', () => {
    const host = terminalHost();
    const { handlers } = harness({ terminal: host });
    expect(() => handlers.get('terminal:open')!(null, 'nope')).toThrow(/terminal:open/);
    expect(() => handlers.get('terminal:open')!(null, { distro: 'Ubuntu' })).toThrow(/terminal:open/);
    expect(() => handlers.get('terminal:write')!(null, 't1', 42)).toThrow(/terminal:write/);
    expect(() => handlers.get('terminal:write')!(null, '', 'YWJj')).toThrow(/terminal:write/);
    expect(() => handlers.get('terminal:resize')!(null, 't1', 'x', 24)).toThrow(/terminal:resize/);
    expect(() => handlers.get('terminal:close')!(null, 5)).toThrow(/terminal:close/);
    expect(() => handlers.get('terminal:attach')!(null, '')).toThrow(/terminal:attach/);
    expect(host.attach).not.toHaveBeenCalled();
    expect(host.open).not.toHaveBeenCalled();
    expect(host.write).not.toHaveBeenCalled();
    expect(host.resize).not.toHaveBeenCalled();
    expect(host.close).not.toHaveBeenCalled();
  });

  it('surfaces terminal error codes to the renderer with the stable prefix', () => {
    const host = terminalHost();
    host.open.mockImplementation(() => {
      throw Object.assign(new Error('limit'), { code: 'TERMINAL_LIMIT' });
    });
    const { handlers } = harness({ terminal: host });
    expect(() => handlers.get('terminal:open')!(null, { distro: 'Ubuntu', cwd: '/p', cols: 80, rows: 24 })).toThrow(
      /TERMINAL_LIMIT: limit/,
    );
  });

  it('forwards attach/write/resize/close to the host', () => {
    const host = terminalHost();
    const { handlers } = harness({ terminal: host });
    expect(handlers.get('terminal:attach')!(null, 't1')).toBe(true);
    expect(host.attach).toHaveBeenCalledWith('t1');
    handlers.get('terminal:write')!(null, 't1', 'YWJj');
    handlers.get('terminal:resize')!(null, 't1', 120, 40);
    handlers.get('terminal:close')!(null, 't1');
    expect(host.write).toHaveBeenCalledWith('t1', 'YWJj');
    expect(host.resize).toHaveBeenCalledWith('t1', 120, 40);
    expect(host.close).toHaveBeenCalledWith('t1');
  });

  it('serves metrics snapshots from the trusted main-process sampler', () => {
    const sample = { at: 5, cpuPercent: 12.5, memUsedBytes: 4, memTotalBytes: 8 };
    const metrics = { sample: vi.fn(() => sample) };
    const { handlers } = harness({ metrics });
    expect(handlers.get('metrics:get')!(null)).toEqual(sample);
    expect(metrics.sample).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing bridge contract untouched', () => {
    const { handlers, conn } = harness({ terminal: terminalHost(), metrics: { sample: () => null as never } });
    expect(handlers.has('bridge:request')).toBe(true);
    handlers.get('bridge:request')!(null, 'listProjects');
    expect(conn.request).toHaveBeenCalled();
  });
});
