/**
 * UI21 F1-B R02 (P1) — тайм-ауты отправки не должны инвертироваться.
 *
 * Реальный сценарий: первая отправка в холодной сессии вернула
 * `BRIDGE_TIMEOUT: request sendPrompt timed out after 10000ms`. Внешний
 * тайм-аут main-процесса (BridgeClient, дефолт 10 000 мс) был МЕНЬШЕ
 * внутреннего бюджета Pi на ACK команды `prompt` (15 000 мс), поэтому
 * здоровый, но медленный ACK холодной сессии выглядел как сбой.
 *
 * Правила, которые фиксирует этот тест:
 *  1) у каждого метода записи внешний тайм-аут строго больше внутреннего;
 *  2) обычные читающие запросы НЕ получают увеличенный тайм-аут;
 *  3) `registerIpc` реально передаёт вычисленный тайм-аут в соединение.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_HANDLER_MARGIN_MS,
  BRIDGE_MAX_REQUEST_TIMEOUT_MS,
  BRIDGE_REQUEST_TIMEOUT_MS,
  bridgeHandlerTimeoutMs,
  PI_COMMAND_TIMEOUT_MS,
  PI_INTERRUPT_TIMEOUT_MS,
  PI_PROMPT_ACK_TIMEOUT_MS,
  methodTimeoutMs,
} from '../../src/shared/timeouts';
import { registerIpc, type IpcLike } from '../../src/main/ipc';

function makeIpc() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcLike = { handle: (channel, fn) => handlers.set(channel, fn) };
  const request = vi.fn(async () => ({ ok: true }));
  const conn = {
    request,
    snapshot: vi.fn(() => ({ phase: 'ready' })),
    retry: vi.fn(() => ({ phase: 'ready' })),
    listDistros: vi.fn(async () => []),
    selectDistro: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeChat: vi.fn(() => () => undefined),
  };
  registerIpc(ipc, conn as never, () => undefined);
  const call = (method: string) => handlers.get('bridge:request')!({}, method, undefined);
  return { request, call };
}

describe('внешний тайм-аут vs внутренний бюджет Pi', () => {
  it('внутренние бюджеты Pi не уменьшены относительно проверенных значений', () => {
    expect(PI_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(PI_INTERRUPT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    // ACK холодной сессии реально приходит дольше 10 с — бюджет обязан это покрывать.
    expect(PI_PROMPT_ACK_TIMEOUT_MS).toBeGreaterThan(10_000);
  });

  it('у каждого метода записи внешний тайм-аут строго больше внутреннего', () => {
    expect(methodTimeoutMs('sendPrompt')).toBeGreaterThan(PI_PROMPT_ACK_TIMEOUT_MS);
    expect(methodTimeoutMs('interrupt')).toBeGreaterThan(PI_INTERRUPT_TIMEOUT_MS);
    for (const method of ['openSession', 'closeSession', 'setModel', 'setThinkingLevel']) {
      expect(methodTimeoutMs(method), method).toBeGreaterThan(PI_COMMAND_TIMEOUT_MS);
    }
  });

  it('операции из нескольких команд Pi получают бюджет на ВСЮ операцию, а не на одну команду', () => {
    // pre-state → мутация → post-state: три последовательные команды по 15 с.
    const threeCommands = 3 * PI_COMMAND_TIMEOUT_MS;
    for (const method of ['openSession', 'closeSession', 'setModel', 'setThinkingLevel']) {
      expect(methodTimeoutMs(method), method).toBeGreaterThan(threeCommands);
    }
  });

  it('бюджет обработчика bridge лежит между бюджетом Pi и внешним тайм-аутом main', () => {
    for (const method of ['openSession', 'sendPrompt', 'interrupt', 'closeSession', 'setModel', 'setThinkingLevel']) {
      expect(bridgeHandlerTimeoutMs(method), method).toBeLessThan(methodTimeoutMs(method));
      expect(bridgeHandlerTimeoutMs(method), method).toBe(methodTimeoutMs(method) - BRIDGE_HANDLER_MARGIN_MS);
    }
    // и он больше внутреннего бюджета соответствующей операции
    expect(bridgeHandlerTimeoutMs('sendPrompt')).toBeGreaterThan(PI_PROMPT_ACK_TIMEOUT_MS);
    expect(bridgeHandlerTimeoutMs('interrupt')).toBeGreaterThan(PI_INTERRUPT_TIMEOUT_MS);
    expect(bridgeHandlerTimeoutMs('openSession')).toBeGreaterThan(3 * PI_COMMAND_TIMEOUT_MS);
  });

  it('потолок bridge больше любого внешнего тайм-аута (иначе он оборвёт первым)', () => {
    for (const method of ['openSession', 'sendPrompt', 'interrupt', 'closeSession', 'setModel', 'setThinkingLevel']) {
      expect(methodTimeoutMs(method), method).toBeLessThan(BRIDGE_MAX_REQUEST_TIMEOUT_MS);
    }
    // и сам потолок не меньше дефолта читающих запросов
    expect(BRIDGE_MAX_REQUEST_TIMEOUT_MS).toBeGreaterThan(BRIDGE_REQUEST_TIMEOUT_MS);
  });

  it('обычные запросы сохраняют прежний тайм-аут 10 000 мс', () => {
    expect(BRIDGE_REQUEST_TIMEOUT_MS).toBe(10_000);
    for (const method of ['listProjects', 'listSessions', 'readSession', 'getAvailableModels', 'getThinkingLevels', 'searchSessions']) {
      expect(methodTimeoutMs(method), method).toBe(BRIDGE_REQUEST_TIMEOUT_MS);
    }
  });
});

describe('registerIpc передаёт вычисленный тайм-аут', () => {
  it('sendPrompt получает бюджет ACK, а не дефолт', async () => {
    const { request, call } = makeIpc();
    await call('sendPrompt');
    expect(request).toHaveBeenCalledWith('sendPrompt', undefined, { timeoutMs: methodTimeoutMs('sendPrompt') });
    expect(methodTimeoutMs('sendPrompt')).toBeGreaterThan(10_000);
  });

  it('читающий метод остаётся на дефолте', async () => {
    const { request, call } = makeIpc();
    await call('readSession');
    expect(request).toHaveBeenCalledWith('readSession', undefined, { timeoutMs: BRIDGE_REQUEST_TIMEOUT_MS });
  });
});
