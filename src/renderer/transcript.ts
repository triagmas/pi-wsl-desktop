/**
 * UI21 R07 — единая лента переписки.
 *
 * Владелец (#6442214523): переключатель «История | Чат» убран; сохранённые
 * сообщения Pi и живые ходы текущего чата показываются в ОДНОМ списке.
 *
 * Границы: только чтение уже полученной страницы `readSession` (M1) и текущего
 * состояния `useChat`. Ни записи в Pi JSONL, ни повторного чтения после живого
 * хода, ни выдуманного содержимого.
 */
import type { ChatEntry } from './useChat';
import { entryView } from './entryText';
import { redactSecrets } from '../shared/redact';

/** Минимальная форма записи страницы истории (M1 `readSession`). */
export interface SavedEntry {
  id?: string | null;
  type: string;
  raw: unknown;
}

/**
 * Сохранённые сообщения → записи ленты. Показываем только реальную переписку:
 * служебные строки сессии (`session`, `model_change`, …) в ленту не попадают.
 */
export function toChatEntries(entries: SavedEntry[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const saved = entries[i];
    if (saved.type !== 'message') continue;
    const view = entryView(saved, i);
    const message = (saved.raw as { message?: { stopReason?: unknown; errorMessage?: unknown } }).message;
    // F1-C: сохранённый неудачный ход остаётся видимой ошибкой, не пустым пузырём.
    const error =
      message?.stopReason === 'error' && typeof message.errorMessage === 'string'
        ? redactSecrets(message.errorMessage)
        : undefined;
    // A stored failed run may have no text at all — the error is its content.
    if (view.text === '' && !error) continue;
    out.push({ key: view.key, kind: view.kind, text: view.text, ...(error ? { error } : {}) });
  }
  return out;
}

/**
 * Хронологическое слияние: сохранённое — сначала, живые ходы — после.
 * Ключи получают префикс источника, поэтому идентификаторы JSONL и живые
 * индексы (`e0`, `e1`, …) не могут столкнуться.
 */
export function mergeTranscript(history: ChatEntry[], live: ChatEntry[]): ChatEntry[] {
  return [
    ...history.map((e, i) => ({ ...e, key: `h:${e.key || i}` })),
    ...live.map((e, i) => ({ ...e, key: `l:${e.key || i}` })),
  ];
}
