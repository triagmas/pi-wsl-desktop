import { describe, expect, it, vi } from 'vitest';
import { registerIpc, type IpcLike } from '../../src/main/ipc';

interface FakeConn {
  request: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  listDistros: ReturnType<typeof vi.fn>;
  selectDistro: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

function makeHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcLike = {
    handle: (channel, fn) => {
      handlers.set(channel, fn);
    },
  };
  const conn: FakeConn = {
    request: vi.fn(async (method: string, params?: unknown) => ({ method, params })),
    snapshot: vi.fn(() => ({ phase: 'ready' })),
    retry: vi.fn(() => ({ phase: 'discovering' })),
    listDistros: vi.fn(async () => ['Ubuntu']),
    selectDistro: vi.fn(),
    subscribe: vi.fn((cb: (s: unknown) => void) => {
      connCallbacks.push(cb);
      return () => undefined;
    }),
  };
  const connCallbacks: ((s: unknown) => void)[] = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const unsubscribe = registerIpc(ipc, conn as unknown as Parameters<typeof registerIpc>[1], (channel, payload) =>
    sent.push({ channel, payload }),
  );
  return { handlers, conn, sent, unsubscribe, connCallbacks };
}

describe('IPC surface (main-side whitelist)', () => {
  it('rejects non-allowlisted methods before they reach the connection', async () => {
    const { handlers, conn } = makeHarness();
    const bridgeRequest = handlers.get('bridge:request')!;
    await expect(bridgeRequest({}, 'exec')).rejects.toThrow(/not allowed/);
    await expect(bridgeRequest({}, 'writeFile')).rejects.toThrow(/not allowed/);
    expect(conn.request).not.toHaveBeenCalled();
  });

  it('delegates allowlisted methods with their params', async () => {
    const { handlers, conn } = makeHarness();
    const bridgeRequest = handlers.get('bridge:request')!;
    const result = (await bridgeRequest({}, 'health', { verbose: true })) as { method: string };
    expect(result.method).toBe('health');
    expect(conn.request).toHaveBeenCalledWith('health', { verbose: true });
  });

  it('exposes status, retry and distro listing', async () => {
    const { handlers, conn } = makeHarness();
    expect((handlers.get('bridge:status')!({}) as { phase: string }).phase).toBe('ready');
    handlers.get('bridge:retry')!({});
    expect(conn.retry).toHaveBeenCalled();
    expect(await handlers.get('bridge:listDistros')!({})).toEqual(['Ubuntu']);
  });

  it('rejects non-string or empty distro selection', async () => {
    const { handlers, conn } = makeHarness();
    const select = handlers.get('bridge:selectDistro')!;
    await expect(select({}, 42)).rejects.toThrow(/distro/);
    await expect(select({}, '')).rejects.toThrow(/distro/);
    expect(conn.selectDistro).not.toHaveBeenCalled();
    await select({}, 'Ubuntu');
    expect(conn.selectDistro).toHaveBeenCalledWith('Ubuntu');
  });

  it('forwards connection snapshots to the renderer channel and unsubscribes', () => {
    const { sent, connCallbacks, unsubscribe, conn } = makeHarness();
    connCallbacks[0]({ phase: 'ready' });
    expect(sent).toEqual([{ channel: 'bridge:state', payload: { phase: 'ready' } }]);
    unsubscribe();
    expect(conn.subscribe).toHaveBeenCalled();
  });
});
