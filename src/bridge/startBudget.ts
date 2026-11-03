/**
 * R03-3 (#26, #6572954720, P2) — единый бюджет холодного запуска Pi.
 *
 * Проблема R02: у каждой команды старта было СВОЁ окно (40 000 мс), а внешний
 * тайм-аут операции — своё число. Сумма окон могла превысить внешний бюджет, и
 * тогда main обрывал запрос раньше, чем bridge успевал ответить своей ошибкой:
 * исход операции становился неопределённым (неясно, создана сессия или нет).
 *
 * Здесь бюджет один на весь запуск (spawn + все команды старта). Каждая команда
 * получает `min(потолок команды, остаток бюджета)`, а исчерпание — явный,
 * быстрый отказ. Так «две допустимо медленные команды подряд» проходят, а
 * зависание не превращается в ожидание чужого тайм-аута.
 */
export const PI_START_MIN_SLICE_MS = 1_000;

export type StartSlice =
  | { ok: true; timeoutMs: number; remainingMs: number }
  | { ok: false; remainingMs: number };

export class StartBudget {
  private readonly deadline: number;

  constructor(
    totalMs: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.deadline = clock() + Math.max(0, totalMs);
  }

  /** Сколько бюджета осталось на момент вызова (никогда не отрицательно). */
  remainingMs(): number {
    return Math.max(0, this.deadline - this.clock());
  }

  /**
   * Окно для следующей команды: не больше её потолка и не больше остатка.
   * Если остаток меньше минимального осмысленного куска — бюджет исчерпан.
   */
  slice(capMs: number): StartSlice {
    const remainingMs = this.remainingMs();
    const floor = Math.min(PI_START_MIN_SLICE_MS, capMs);
    if (remainingMs < floor) return { ok: false, remainingMs };
    return { ok: true, timeoutMs: Math.min(capMs, remainingMs), remainingMs };
  }
}
