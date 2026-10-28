/**
 * UI21 F1-B Startup Gate R01 (P1) — транзиентный сбой пробы ≠ несовместимость.
 *
 * До фикса любая ошибка готового гейта (включая тайм-аут `pi --help` и
 * сорванную пробу) уводила приложение в ПОСТОЯННУЮ ошибку `PI_INCOMPATIBLE`
 * без автоповтора: рабочий Pi оставался недоступен до ручного «Повторить».
 *
 * Контракт:
 * 1) транзиентная проба (BRIDGE_TIMEOUT / проба не доказана) → ограниченный
 *    автоповтор с backoff и в итоге READY;
 * 2) доказанная несовместимость (PI_INCOMPATIBLE) и отсутствие Pi
 *    (PI_NOT_FOUND) → по-прежнему окончательный отказ без автоповтора;
 * 3) готовый гейт — ОДИН запрос к мосту (getCapabilities несёт данные Pi),
 *    без последовательной пары getRuntimeInfo + getCapabilities.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WslConnection } from '../../src/main/connection';

const FAKE_WSL = path.join(__dirname, '..', 'fixtures', 'fake-wsl');
const FAKE_BRIDGE = path.join(__dirname, '..', 'fixtures', 'fake-bridge.cjs');

function makeConn(
  overrides: Record<string, string> = {},
  maxAutoAttempts = 3,
  timeouts: Record<string, number> = {},
) {
  const log = path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-gate-')), 'wsl.log');
  writeFileSync(log, '');
  const env: Record<string, string> = {
    FAKE_WSL_LOG: log,
    FAKE_BRIDGE_LOG: log,
    FAKE_WSL_PROBE_JSON: JSON.stringify({
      ok: true,
      nodePath: process.execPath,
      nodeVersion: process.version,
      home: '/home/fake',
      bridgeOk: true,
    }),
    ...overrides,
  };
  const conn = new WslConnection({
    bridgeWinPath: FAKE_BRIDGE,
    wslPath: FAKE_WSL,
    env,
    maxAutoAttempts,
    backoffMs: [50, 50, 50],
    timeouts: { listMs: 3000, probeMs: 500, readyMs: 400, requestMs: 2000, ...timeouts },
  });
  return { conn, log };
}

async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const lines = (log: string) => readFileSync(log, 'utf8').split('\n').filter(Boolean);
const spawns = (log: string) => lines(log).filter((l) => l.includes('[/usr/bin/env]')).length;
const framesOf = (log: string, method: string) =>
  lines(log).filter((l) => l.startsWith('frame:') && l.includes(`"method":"${method}"`)).length;

describe('ready-gate transient vs definitive', () => {
  it('retries a transient capability probe and reaches READY (no false PI_INCOMPATIBLE)', async () => {
    const gateFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-gateflag-')), 'transient.once');
    const { conn, log } = makeConn({ FAKE_BRIDGE_GATE_TRANSIENT_FILE: gateFile });
    const sawError: string[] = [];
    conn.subscribe((s) => {
      if (s.lastError && !sawError.includes(s.lastError.code)) sawError.push(s.lastError.code);
    });
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 12_000, 'ready after transient gate');
    const snap = conn.snapshot();
    expect(snap.phase).toBe('ready');
    // Транзиентная проба была замечена и НЕ превратилась в окончательный отказ.
    expect(sawError).toContain('BRIDGE_TIMEOUT');
    expect(sawError).not.toContain('PI_INCOMPATIBLE');
    expect(snap.attempt).toBe(0); // READY сбрасывает счётчик попыток
    expect(spawns(log)).toBeGreaterThanOrEqual(2); // был повторный цикл
    expect((snap.runtime as { pi?: { version?: string } } | null)?.pi?.version).toBe('9.9.9');
    conn.close();
  });

  it('stops after maxAutoAttempts when the probe never succeeds — no endless reconnects', async () => {
    const { conn, log } = makeConn({ FAKE_BRIDGE_GATE_TRANSIENT_ALWAYS: '1' }, 2);
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'error', 20_000, 'bounded retries end in error');
    await new Promise((r) => setTimeout(r, 300));
    expect(conn.snapshot().lastError?.code).toBe('BRIDGE_TIMEOUT');
    expect(spawns(log)).toBe(2); // ровно maxAutoAttempts, ни одного лишнего
    conn.close();
  });

  it('proven incompatibility stays a final refusal: no auto-retry, no extra bridge spawn', async () => {
    const { conn, log } = makeConn({
      PI_WS_DESKTOP_PI: path.join(__dirname, '..', 'fixtures', 'fakepi-norpc'),
    });
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'error', 10_000, 'error');
    expect(conn.snapshot().lastError?.code).toBe('PI_INCOMPATIBLE');
    await new Promise((r) => setTimeout(r, 400)); // дать шанс ошибочному автоповтору
    expect(spawns(log)).toBe(1);
    conn.close();
  });

  it('a missing Pi stays a final refusal as well', async () => {
    const { conn, log } = makeConn({ PI_WS_DESKTOP_PI: path.join(os.tmpdir(), 'no-pi-here-7a1c') });
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'error', 10_000, 'error');
    expect(conn.snapshot().lastError?.code).toBe('PI_NOT_FOUND');
    await new Promise((r) => setTimeout(r, 300));
    expect(spawns(log)).toBe(1);
    conn.close();
  });

  it('the ready gate issues each request once (no duplicate round-trips)', async () => {
    const { conn, log } = makeConn();
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 10_000, 'ready');
    // Оба запроса — часть гейта, но каждый РОВНО один раз (без повторов и без
    // последовательных пар): проба Pi внутри моста тоже одна.
    expect(framesOf(log, 'getCapabilities')).toBe(1);
    expect(framesOf(log, 'getRuntimeInfo')).toBe(1);
    const gateFrames = lines(log).filter((l) => l.startsWith('frame:'));
    expect(gateFrames).toHaveLength(2);
    conn.close();
  });

  it('actually asks in PARALLEL: capabilities answers while runtime is still pending', async () => {
    // Мост отвечает на getRuntimeInfo с задержкой 400 мс. При последовательном
    // гейте capabilities-запрос ушёл бы только после ответа runtime, поэтому в
    // журнале `responded:getCapabilities` стоял бы ПОСЛЕ `responded:getRuntimeInfo`.
    const { conn, log } = makeConn({ FAKE_BRIDGE_RUNTIME_DELAY_MS: '400' });
    const t0 = Date.now();
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 10_000, 'ready');
    const elapsed = Date.now() - t0;
    const order = lines(log).filter((l) => l.startsWith('responded:'));
    expect(order.indexOf('responded:getCapabilities')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('responded:getCapabilities')).toBeLessThan(order.indexOf('responded:getRuntimeInfo'));
    // Параллельно: гейт ≈ задержка runtime, а не две задержки подряд.
    expect(elapsed).toBeLessThan(1200);
    conn.close();
  });

  it('the handler budget actually sent to the bridge covers the whole Pi probe', async () => {
    // Проверяем не константу, а кадр на проводе: BridgeClient вычитает запас,
    // и именно остаток должен вмещать version + режим + резервный help.
    const { conn, log } = makeConn();
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 10_000, 'ready');
    const frames = lines(log)
      .filter((l) => l.startsWith('frame:'))
      .map((l) => JSON.parse(l.slice('frame:'.length)));
    const budgets = frames.map((f) => f.timeoutMs).filter((n) => typeof n === 'number');
    expect(budgets.length).toBeGreaterThan(0);
    const { PI_RPC_PROBE_BUDGET_MS } = await import('../../src/shared/timeouts');
    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(PI_RPC_PROBE_BUDGET_MS);
    conn.close();
  });

  it('waits for a slow probe fallback: gate budget, not the default request timeout', async () => {
    // Мост отвечает на getCapabilities через 9 с (как резервный `pi --help` на
    // холодном DrvFs), а обычный requestMs — 2 с. С gateMs=20 с гейт обязан
    // дождаться ответа на ПЕРВОЙ попытке, без обрыва соединения.
    const { conn, log } = makeConn({ FAKE_BRIDGE_GATE_DELAY_MS: '9000' }, 3, { gateMs: 20_000 });
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 20_000, 'ready after slow fallback');
    expect(spawns(log)).toBe(1); // никаких перезапусков из-за «короткого» бюджета
    conn.close();
  });

  it('publishes background distro discovery to subscribers after READY', async () => {
    // Дистрибутив задан конфигом → wsl --list идёт фоном. UI-селекторы читают
    // snapshot.distros, поэтому список обязан доехать подписчикам.
    const { conn } = makeConn({ PI_WS_DESKTOP_DISTRO: 'Ubuntu', FAKE_WSL_LIST_DELAY_MS: '700' });
    const seen: Array<string[] | null> = [];
    conn.subscribe((snap) => seen.push(snap.distros));
    conn.start();
    await waitFor(() => conn.snapshot().phase === 'ready', 10_000, 'ready');
    await waitFor(() => (conn.snapshot().distros ?? []).length > 0, 10_000, 'distros published');
    expect(seen.some((d) => (d ?? []).length > 0)).toBe(true);
    conn.close();
  });
});
