import { describe, expect, it, vi } from 'vitest';
import { registerIpc, type IpcLike } from '../../src/main/ipc';

interface FakeConn {
  request: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  listDistros: ReturnType<typeof vi.fn>;
  selectDistro: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  subscribeChat: ReturnType<typeof vi.fn>;
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
    subscribeChat: vi.fn((cb: (ev: unknown) => void) => {
      chatCallbacks.push(cb);
      return () => {
        chatCallbacks.length = 0;
      };
    }),
  };
  const connCallbacks: ((s: unknown) => void)[] = [];
  const chatCallbacks: ((ev: unknown) => void)[] = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const unsubscribe = registerIpc(ipc, conn as unknown as Parameters<typeof registerIpc>[1], (channel, payload) =>
    sent.push({ channel, payload }),
  );
  return { handlers, conn, sent, unsubscribe, connCallbacks, chatCallbacks };
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

describe('IPC chat event relay (M1)', () => {
  it('forwards chat payloads from the connection to the bridge:chat channel', () => {
    const { chatCallbacks, sent } = makeHarness();
    expect(chatCallbacks).toHaveLength(1); // registerIpc subscribed on construction
    const payload = { kind: 'opened', state: null };
    chatCallbacks[0](payload);
    expect(sent).toEqual([{ channel: 'bridge:chat', payload }]);
  });

  it('the composite unsubscribe stops chat forwarding too', () => {
    const { chatCallbacks, sent, unsubscribe } = makeHarness();
    unsubscribe();
    expect(chatCallbacks).toHaveLength(0);
    // no callback remains registered → nothing can be forwarded
    expect(sent).toEqual([]);
  });

  it('M1 write-boundary methods pass the whitelist while junk still dies', async () => {
    const { handlers, conn } = makeHarness();
    const bridgeRequest = handlers.get('bridge:request')!;
    await expect(bridgeRequest({}, 'sendPrompt')).resolves.toBeTruthy();
    await expect(bridgeRequest({}, 'closeSession')).resolves.toBeTruthy();
    await expect(bridgeRequest({}, 'rm')).rejects.toThrow(/not allowed/);
    expect(conn.request).toHaveBeenCalledTimes(2);
  });
});
