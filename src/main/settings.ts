/**
 * Windows-side UI preferences (distro selection, optional path overrides).
 * This is the ONLY file the desktop app writes: Pi's own configuration in
 * WSL is never copied or modified (SPECIFICATION.md §6).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const SettingsSchema = z
  .object({
    distro: z.string().min(1).optional(),
    nodeOverride: z.string().min(1).optional(),
  })
  .passthrough();

export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_FILE = 'settings.json';

export function loadSettings(dir: string): Settings {
  try {
    const raw = readFileSync(path.join(dir, SETTINGS_FILE), 'utf8');
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {}; // missing or corrupt → defaults; never blocks startup
  }
}

export function saveSettings(dir: string, patch: Partial<Settings>): Settings {
  const merged: Settings = { ...loadSettings(dir), ...patch };
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, SETTINGS_FILE);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  renameSync(tmp, target);
  return merged;
}
