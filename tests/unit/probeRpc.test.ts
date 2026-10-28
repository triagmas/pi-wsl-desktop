/**
 * UI21 F1-B Startup Gate R01 (P1) — ложное PI_INCOMPATIBLE.
 *
 * Наблюдение владельца: рабочий Pi 1.4.0 при запуске иногда помечался
 * «not advertise RPC mode». Причина: единственным доказательством RPC был
 * скрейп `pi --help`, а его тайм-аут (8 с) трактовался как «не поддерживает».
 * На этой машине `pi --help` холодным — 17.8 с, тёплым — 3.8 с, то есть
 * рабочий Pi штатно выходит за 8 с и попадает в несовместимые.
 *
 * Контракт, который фиксируют тесты:
 * 1) дешёвая окончательная проверка — `pi --mode <probe> --help`: Pi сам
 *    разбирает argv, печатает список режимов и НЕ стартует сессию;
 * 2) «обе команды не ответили/упали» — это `unknown` (транзиентно), а НЕ
 *    `unsupported`: ложный отказ запрещён;
 * 3) настоящий Pi без RPC (список режимов без rpc) по-прежнему отвергается
 *    строго;
 * 4) `--help` вызывается только как резерв, когда дешёвая проверка ничего
 *    не доказала.
 */
import { describe, expect, it, vi } from 'vitest';
import { probePi, type SpawnResult } from '../../src/bridge/probe';

type Kind = 'version' | 'mode' | 'help';
const VERSION_OK: SpawnResult = { code: 0, stdout: 'pi 1.4.0\n', stderr: '' };

function classify(args: string[]): Kind {
  if (args.includes('--version')) return 'version';
  if (args[0] === '--mode') return 'mode';
  if (args.includes('--help')) return 'help';
  throw new Error(`unexpected spawn: ${args.join(' ')}`);
}

function makeSpawn(handlers: Partial<Record<Kind, SpawnResult | (() => SpawnResult)>>) {
  const calls: string[][] = [];
  const fn = vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args);
    const kind = classify(args);
    const h = handlers[kind];
    if (!h) throw new Error(`unexpected ${kind} spawn: ${args.join(' ')}`);
    return typeof h === 'function' ? h() : h;
  });
  return { fn, calls };
}

const env = { HOME: '/home/fake', PATH: '/nonexistent-bin', PI_WS_DESKTOP_PI: '/home/fake/.local/bin/pi' };
const probe = (spawnFn: ReturnType<typeof makeSpawn>['fn']) =>
  probePi({ env, home: env.HOME, spawnFn, timeoutMs: 8000 });

const MODES_RPC: SpawnResult = {
  code: 1,
  stdout: '',
  stderr: 'Error: Invalid mode "__pi_desktop_probe__". Valid values: text, json, rpc\n',
};
const MODES_NO_RPC: SpawnResult = {
  code: 1,
  stdout: '',
  stderr: 'Error: Invalid mode "__pi_desktop_probe__". Valid values: text, json\n',
};
const HELP_RPC: SpawnResult = { code: 0, stdout: 'Usage: pi [options]\n  --mode <mode>  text|json|rpc\n', stderr: '' };

describe('probePi RPC capability (transient vs definitive)', () => {
  it('proves RPC from the cheap mode-list probe without ever scraping --help', async () => {
    const { fn, calls } = makeSpawn({ version: VERSION_OK, mode: MODES_RPC });
    const p = await probe(fn);
    expect(p).toMatchObject({ version: '1.4.0', rpcSupported: true, rpcStatus: 'supported' });
    // Дешёвая проверка — разбор argv, а не запуск сессии:
    expect(calls.find((a) => a[0] === '--mode')).toEqual(['--mode', expect.any(String), '--help']);
    expect(calls.some((a) => a.includes('--help') && a[0] !== '--mode')).toBe(false);
  });

  it('rejects a Pi that does not advertise rpc — strictly', async () => {
    const { fn } = makeSpawn({ version: VERSION_OK, mode: MODES_NO_RPC });
    const p = await probe(fn);
    expect(p).toMatchObject({ rpcSupported: false, rpcStatus: 'unsupported' });
  });

  it('falls back to --help when the mode probe is inconclusive, and accepts a real rpc Pi', async () => {
    const { fn, calls } = makeSpawn({
      version: VERSION_OK,
      mode: () => {
        throw new Error('spawn timed out');
      },
      help: HELP_RPC,
    });
    const p = await probe(fn);
    expect(p).toMatchObject({ rpcSupported: true, rpcStatus: 'supported' });
    expect(calls.some((a) => a.includes('--help') && a[0] !== '--mode')).toBe(true);
  });

  it('treats a timed-out --help as UNKNOWN, never as "does not support RPC"', async () => {
    const { fn } = makeSpawn({
      version: VERSION_OK,
      mode: () => {
        throw new Error('spawn timed out');
      },
      help: () => {
        throw new Error('spawn timed out after 20000ms');
      },
    });
    const p = await probe(fn);
    expect(p?.rpcStatus).toBe('unknown');
    expect(p?.rpcSupported).toBe(false); // не доказано — но и не «несовместим»
    expect(p?.version).toBe('1.4.0'); // сам Pi найден и работает
  });

  it('treats a broken --help (env/PATH failure, exit 127) as UNKNOWN', async () => {
    const { fn } = makeSpawn({
      version: VERSION_OK,
      mode: () => {
        throw new Error('spawn ENOENT');
      },
      help: { code: 127, stdout: '', stderr: '/usr/bin/env: node: No such file or directory\n' },
    });
    const p = await probe(fn);
    expect(p?.rpcStatus).toBe('unknown');
  });

  it('never treats a signal-killed probe (code null) as a verdict — even with a complete list', async () => {
    // code === null → процесс убит сигналом; вывод мог быть обрезан.
    const { fn } = makeSpawn({
      version: VERSION_OK,
      mode: { code: null, stdout: '', stderr: 'Error: Invalid mode "x". Valid values: text, json\n' },
      help: () => {
        throw new Error('spawn timed out');
      },
    });
    const p = await probe(fn);
    expect(p?.rpcStatus).toBe('unknown');
    expect(p?.rpcStatus).not.toBe('unsupported');
  });

  it('a signal-killed probe with a truncated list falls back to --help instead of judging', async () => {
    const { fn, calls } = makeSpawn({
      version: VERSION_OK,
      mode: { code: null, stdout: '', stderr: 'Valid values: text, json, rp' },
      help: HELP_RPC,
    });
    const p = await probe(fn);
    expect(p?.rpcStatus).toBe('supported'); // решил help, а не обрезанный список
    expect(calls.some((a) => a.includes('--help') && a[0] !== '--mode')).toBe(true);
  });

  it('its whole worst case (version + mode + help) fits inside the real gate budget', async () => {
    const {
      PI_RPC_PROBE_BUDGET_MS,
      BRIDGE_HANDLER_MARGIN_MS,
      BRIDGE_MAX_REQUEST_TIMEOUT_MS,
      GATE_REQUEST_MS,
      methodTimeoutMs,
    } = await import('../../src/shared/timeouts');
    // Бюджет обработчика в bridge (внешний минус запас) обязан покрыть
    // version + режим + резервный help.
    expect(GATE_REQUEST_MS - BRIDGE_HANDLER_MARGIN_MS).toBeGreaterThanOrEqual(PI_RPC_PROBE_BUDGET_MS);
    expect(GATE_REQUEST_MS).toBeLessThanOrEqual(BRIDGE_MAX_REQUEST_TIMEOUT_MS);
    // Тот же метод, вызванный из UI (детали/обновление), тоже может запустить
    // пробу — он обязан получить тот же бюджет, а не обычные 10 с.
    expect(methodTimeoutMs('getRuntimeInfo')).toBeGreaterThanOrEqual(PI_RPC_PROBE_BUDGET_MS);
    expect(methodTimeoutMs('getCapabilities')).toBeGreaterThanOrEqual(PI_RPC_PROBE_BUDGET_MS);
  });

  it('still rejects when the mode list is proof-positive that rpc is absent', async () => {
    // Pi старее RPC-режима: и дешёвая проверка, и help без rpc.
    const { fn } = makeSpawn({
      version: VERSION_OK,
      mode: MODES_NO_RPC,
      help: { code: 0, stdout: 'Usage: pi [options]\n  --mode <mode>  text|json\n', stderr: '' },
    });
    const p = await probe(fn);
    expect(p?.rpcStatus).toBe('unsupported');
  });

  it('an unknown-option mode probe (exit 0, no mode list) falls through to --help', async () => {
    const { fn, calls } = makeSpawn({
      version: VERSION_OK,
      mode: { code: 0, stdout: 'Usage: pi [options]\n', stderr: '' },
      help: { code: 0, stdout: 'Usage: pi [options]\n  --mode text|json\n', stderr: '' },
    });
    const p = await probe(fn);
    expect(p?.rpcStatus).toBe('unsupported');
    expect(calls.filter((a) => a[0] === '--mode')).toHaveLength(1);
  });

  it('keeps the cheap probe fast: it uses a short budget, not the slow --help one', async () => {
    const seen: Array<{ kind: Kind; timeoutMs: number }> = [];
    const fn = vi.fn(async (_cmd: string, args: string[], opts: { timeoutMs: number }) => {
      const kind = classify(args);
      seen.push({ kind, timeoutMs: opts.timeoutMs });
      if (kind === 'version') return VERSION_OK;
      return MODES_RPC;
    });
    await probePi({ env, home: env.HOME, spawnFn: fn, timeoutMs: 8000 });
    const modeCall = seen.find((s) => s.kind === 'mode');
    expect(modeCall).toBeDefined();
    expect(modeCall!.timeoutMs).toBeLessThanOrEqual(8000);
  });
});
