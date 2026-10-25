/**
 * Design Lab: applies the immutable DARK preset to a root element.
 *
 * Tokens come from the single source of truth (`shared/design/presets`);
 * the Design Lab never hard-codes colors — a theme swaps TOKENS only.
 */
import { THEME_PRESETS } from '../../shared/design/presets';
import { applyTheme } from './applyTheme';

export function applyDarkTheme(root: HTMLElement): void {
  applyTheme(root, THEME_PRESETS.dark.tokens);
}
