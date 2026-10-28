/**
 * UI21 F1-B Startup Gate R01 — одна проба Pi на весь мост.
 *
 * Готовый гейт спрашивает getRuntimeInfo и getCapabilities параллельно. До
 * фикса каждый метод запускал свою пару `pi --version` + `pi --help`, то есть
 * на старте выполнялись четыре дочерних процесса Pi (и каждый мог упереться в
 * 8-секундный тайм-аут). Кэш теперь делит один in-flight probe.
 *
 * Отдельно фиксируется транзиентность: недоказанная проба (`unknown`) не
 * кэшируется навсегда — следующий вызов перепробует, а не «запомнит» отказ.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeHandlers } from '../../src/bridge/handlers';
import type { SpawnResult } from '../../src/bridge/probe';

const env = { HOME: '/home/fake', PATH: '/nonexistent-bin', PI_WS_DESKTOP_PI: '/home/fake/.local/bin/pi' };
const VERSION: SpawnResult = { code: 0, stdout: 'pi 1.4.0\n', stderr: '' };
const MODES_RPC: SpawnResult = {
  code: 1,
  stdout: '',
  stderr: 'Error: Invalid mode "x". Valid values: text, json, rpc\n',
};

function countingSpawn(overrides: { mode?: SpawnResult | (() => SpawnResult); help?: SpawnResult | (() => SpawnResult) } = {}) {
  const calls: string[][] = [];
  const fn = vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args.includes('--version')) return VERSION;
    if (args[0] === '--mode') {
      const h = overrides.mode ?? MODES_RPC;
      return typeof h === 'function' ? h() : h;
    }
    if (args.includes('--help')) {
      const h = overrides.help ?? { code: 1, stdout: '', stderr: '' };
      return typeof h === 'function' ? h() : h;
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  });
  return { fn, calls };
}

function ctx(spawnFn: ReturnType<typeof countingSpawn>['fn']) {
  return { env, home: env.HOME, spawnFn, testMode: true };
}

describe('bridge probe sharing and transient handling', () => {
  it('shares ONE probe between parallel getRuntimeInfo and getCapabilities', async () => {
    const { fn, calls } = countingSpawn();
    const h = makeHandlers(ctx(fn));
    const sig = new AbortController().signal;
    const [runtime, caps] = await Promise.all([h.getRuntimeInfo({}, sig), h.getCapabilities({}, sig)]);
    expect((runtime as { pi: { version: string } }).pi.version).toBe('1.4.0');
    expect((caps as { pi: { rpcSupported: boolean } }).pi.rpcSupported).toBe(true);
    // ровно один `--version` и один дешёвый `--mode` — никакого `--help`
    expect(calls.filter((a) => a.includes('--version'))).toHaveLength(1);
    expect(calls.filter((a) => a[0] === '--mode')).toHaveLength(1);
    expect(calls.filter((a) => a.includes('--help') && a[0] !== '--mode')).toHaveLength(0);
  });

  it('rejects an unsupported Pi with PI_INCOMPATIBLE (definitive verdict)', async () => {
    const { fn } = countingSpawn({ mode: { code: 1, stdout: '', stderr: 'Valid values: text, json\n' } });
    const h = makeHandlers(ctx(fn));
    await expect(h.getCapabilities({}, new AbortController().signal)).rejects.toMatchObject({ code: 'PI_INCOMPATIBLE' });
  });

  it('reports an unproven probe as transient BRIDGE_TIMEOUT, not as incompatibility', async () => {
    const fail = () => {
      throw new Error('spawn timed out');
    };
    const { fn } = countingSpawn({ mode: fail, help: fail });
    const h = makeHandlers(ctx(fn));
    await expect(h.getCapabilities({}, new AbortController().signal)).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' });
    // getRuntimeInfo при этом честно отдаёт найденный Pi — он существует.
    const runtime = (await h.getRuntimeInfo({}, new AbortController().signal)) as { pi: { version: string; rpcSupported: boolean } };
    expect(runtime.pi).toMatchObject({ version: '1.4.0', rpcSupported: false });
  });

  it('re-probes after a transient failure instead of caching the "no" forever', async () => {
    let attempt = 0;
    const { fn, calls } = countingSpawn({
      mode: () => {
        attempt += 1;
        if (attempt === 1) throw new Error('spawn timed out');
        return MODES_RPC;
      },
      help: () => {
        throw new Error('spawn timed out');
      },
    });
    const h = makeHandlers(ctx(fn));
    await expect(h.getCapabilities({}, new AbortController().signal)).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' });
    // Второй вызов (после автоповтора соединения) должен пройти успешно.
    await expect(h.getCapabilities({}, new AbortController().signal)).resolves.toMatchObject({ pi: { rpcSupported: true } });
    expect(calls.filter((a) => a[0] === '--mode').length).toBeGreaterThanOrEqual(2);
  });
});
