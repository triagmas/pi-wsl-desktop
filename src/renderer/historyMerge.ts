/**
 * Pure accumulation of history pages (M1, review round 4).
 *
 * The `readSessionFile` cursor is strictly forward: page 1 holds the EARLIEST
 * entries and every continuation holds LATER ones. A continuation page is
 * therefore APPENDED after the current entries — prepending it would mix the
 * chronology of any session longer than one page.
 */
import type { ReadSessionResultT } from './types';

export function mergeHistoryPage(
  prev: ReadSessionResultT | null,
  next: ReadSessionResultT,
  since?: string,
): ReadSessionResultT {
  return prev && since ? { ...next, entries: [...prev.entries, ...next.entries] } : next;
}
