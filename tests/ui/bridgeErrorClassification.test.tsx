/**
 * UI21 F1-B R02 (P1) — классификация ошибки Electron IPC.
 *
 * Реальный отказ пришёл в renderer как
 *   `UNKNOWN — Error invoking remote method 'bridge:request':
 *    Error: BRIDGE_TIMEOUT: request sendPrompt timed out after 10000ms`
 * то есть стабильный код `BRIDGE_TIMEOUT` терялся: main кладёт его в текст
 * (`{CODE}: message`), а Electron оборачивает вызов в
 * `Error invoking remote method '<channel>': Error: …`. Парсер требовал код в
 * начале строки и не снимал обёртку → пользователь видел «UNKNOWN» и шумный
 * текст вместо понятной причины.
 */
import { describe, expect, it } from 'vitest';
import { parseBridgeError } from '../../src/renderer/m1api';

const OBSERVED =
  "Error invoking remote method 'bridge:request': Error: BRIDGE_TIMEOUT: request sendPrompt timed out after 10000ms";

describe('parseBridgeError — обёртка Electron IPC', () => {
  it('снимает обёртку и сохраняет BRIDGE_TIMEOUT (точная строка из отказа)', () => {
    expect(parseBridgeError(new Error(OBSERVED))).toEqual({
      code: 'BRIDGE_TIMEOUT',
      message: 'request sendPrompt timed out after 10000ms',
    });
  });

  it('не оставляет в тексте ни канала, ни лишнего "Error:"', () => {
    const parsed = parseBridgeError(new Error(OBSERVED));
    expect(parsed.message).not.toMatch(/invoking remote method/);
    expect(parsed.message).not.toMatch(/^Error:/);
  });

  it('двойная обёртка и другие коды тоже распознаются', () => {
    const wrapped =
      "Error invoking remote method 'bridge:request': Error: Error invoking remote method 'bridge:request': Error: RESOURCE_BUSY: Agent is streaming";
    expect(parseBridgeError(new Error(wrapped))).toEqual({
      code: 'RESOURCE_BUSY',
      message: 'Agent is streaming',
    });
  });

  it('структурный .code по-прежнему приоритетнее текста', () => {
    const err = Object.assign(new Error("Error invoking remote method 'bridge:request': Error: UNKNOWN: boom"), {
      code: 'SESSION_CONFLICT',
    });
    expect(parseBridgeError(err)).toEqual({ code: 'SESSION_CONFLICT', message: 'boom' });
  });

  it('плоский код без обёртки не сломан (регресс)', () => {
    expect(parseBridgeError(new Error('BRIDGE_TIMEOUT: request openSession timed out'))).toEqual({
      code: 'BRIDGE_TIMEOUT',
      message: 'request openSession timed out',
    });
  });

  it('сообщение без кода остаётся UNKNOWN, но без обёртки', () => {
    expect(parseBridgeError(new Error("Error invoking remote method 'bridge:request': Error: pipe closed"))).toEqual({
      code: 'UNKNOWN',
      message: 'pipe closed',
    });
  });
});
