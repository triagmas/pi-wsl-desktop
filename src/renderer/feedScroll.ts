/**
 * UI21 F1-B R03 — прокрутка ленты чата (чистая математика, без DOM).
 *
 * Панель чата держится последнего сообщения, но НЕ имеет права:
 * - дёргать пользователя вниз, если он сам отлистал вверх (в том числе во время
 *   генерации: `message_end` меняет хвост ленты);
 * - прыгать вниз при подгрузке СТАРЫХ записей — там нужно сохранить видимую
 *   позицию, потому что контент добавляется сверху.
 *
 * Поэтому решение о целевой позиции вынесено в чистые функции и покрыто
 * тестами: сама панель только применяет результат.
 */

export interface FeedMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Нижняя граница «прилипания»: ближе 24 px к концу считаем «внизу». */
export const STICK_THRESHOLD_PX = 24;

/** Пользователь находится в конце ленты (значит новые записи можно догонять). */
export function isAtBottom(m: FeedMetrics): boolean {
  return Math.abs(m.scrollHeight - m.scrollTop - m.clientHeight) < STICK_THRESHOLD_PX;
}

/**
 * Позиция после ВСТАВКИ контента сверху (подгрузка более ранних записей):
 * сохраняем то, что пользователь видел. `before` — метрики ДО вставки.
 */
export function anchorScrollTop(before: FeedMetrics, after: { scrollHeight: number }): number {
  const delta = after.scrollHeight - before.scrollHeight;
  return Math.max(0, before.scrollTop + delta);
}

/** Целевая позиция для «догнать последнее сообщение». */
export function stickScrollTop(m: { scrollHeight: number }): number {
  return m.scrollHeight;
}
