/**
 * UI26 R01 — display titles for sessions and drafts.
 *
 * Source of truth for a name is Pi itself (`session_info.name`). Only when Pi
 * has no name do we derive one from the first user message, and only as a last
 * resort do we show a short id. Nothing here guesses a session: it is a pure
 * formatting layer over data the bridge already read from the session file.
 *
 * Unicode safety: truncation counts code points, so an emoji or a multi-byte
 * script is never cut in the middle of a surrogate pair / grapheme cluster.
 */

/** Maximum display length (code points), ellipsis included. */
export const TITLE_MAX = 80;

/** Short id fallback length — a UUID prefix is enough to tell sessions apart. */
export const SHORT_ID_MAX = 8;

/** Single-line title: newlines/tabs/repeated spaces collapse to one space. */
export function collapseTitle(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Truncate to `max` code points INCLUDING the ellipsis. Text that already fits
 * is returned verbatim (no dangling ellipsis on short names).
 */
export function truncateTitle(text: string, max: number = TITLE_MAX): string {
  const points = [...text];
  if (points.length <= max) return text;
  if (max <= 1) return '…'.slice(0, Math.max(max, 0));
  return `${points.slice(0, max - 1).join('')}…`;
}

export type DisplayNameSource = 'pi' | 'firstUser' | 'id';

export interface DisplayNameInput {
  /** Pi's explicit name (`session_info.name` / `get_state.sessionName`). */
  piName?: string | null;
  /** First user message text, if the session already has one. */
  firstUserText?: string | null;
  /** Session id (UUID from the file header) or any stable identifier. */
  id: string;
}

export interface DisplayName {
  displayName: string;
  displayNameSource: DisplayNameSource;
}

/**
 * Precedence: explicit Pi name → first user message → short id.
 * A blank name is not a name, and a blank message is not a title.
 */
export function deriveDisplayName(input: DisplayNameInput): DisplayName {
  const piName = input.piName === null || input.piName === undefined ? '' : collapseTitle(input.piName);
  if (piName !== '') return { displayName: truncateTitle(piName), displayNameSource: 'pi' };

  const first = input.firstUserText === null || input.firstUserText === undefined ? '' : collapseTitle(input.firstUserText);
  if (first !== '') return { displayName: truncateTitle(first), displayNameSource: 'firstUser' };

  const id = collapseTitle(input.id ?? '');
  const short = [...id].slice(0, SHORT_ID_MAX).join('') || '(без имени)';
  return { displayName: short, displayNameSource: 'id' };
}
