/**
 * Persisted appearance storage (theme/typography/layout) — atomic write via
 * tmp+rename, per-field migration/repair, fail-safe defaults. Same lifecycle
 * as settings.json, separate file so a corrupt theme never loses the WSL
 * distro selection and vice versa.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APPEARANCE_VERSION,
  DEFAULT_APPEARANCE,
  migrateAppearance,
  type AppearanceSettings,
} from '../shared/appearance';

export const APPEARANCE_FILE = 'appearance.json';

export { APPEARANCE_VERSION, DEFAULT_APPEARANCE };

export function loadAppearance(dir: string): AppearanceSettings {
  try {
    const file = path.join(dir, APPEARANCE_FILE);
    if (!existsSync(file)) return structuredClone(DEFAULT_APPEARANCE);
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return migrateAppearance(raw);
  } catch {
    return structuredClone(DEFAULT_APPEARANCE); // missing/corrupt → defaults
  }
}

export function saveAppearance(dir: string, next: AppearanceSettings): AppearanceSettings {
  const normalized = migrateAppearance(next); // normalize before persisting
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, APPEARANCE_FILE);
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
    renameSync(tmp, target);
  } catch (error) {
    // Never leave a half-written target; the previous file (if any) stays.
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
  return normalized;
}

export function resetAppearance(dir: string): AppearanceSettings {
  return saveAppearance(dir, structuredClone(DEFAULT_APPEARANCE));
}
