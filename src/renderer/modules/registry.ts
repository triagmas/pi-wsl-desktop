/**
 * M3 module registry (renderer-side, pure) — registration, enable/disable and
 * the tab projection the App renders through ONE generic contract.
 *
 * Invariants (SPECIFICATION §5, PRODUCT §3.4):
 * - `registerModules` NEVER throws: every raw value becomes exactly one entry
 *   with an honest state (`enabled | disabled | invalid | incompatible`);
 * - a duplicate id fails the LATER registration closed, the first stands;
 * - only `enabled` entries project tabs — invalid/incompatible modules can
 *   never put UI on screen, and `setModuleEnabled` cannot promote them;
 * - adding a module must not require patching the core: App maps over
 *   `moduleTabs()` output.
 */
import { parseModuleManifest, type ModuleManifest, type ModuleUiEntry } from '../../shared/m3Protocol';

export type ModuleState = 'enabled' | 'disabled' | 'invalid' | 'incompatible';

export interface ModuleEntry {
  /** Stable per-registration key (survives duplicate ids). */
  key: string;
  /** Declared module id, or a best-effort fallback for unparseable raws. */
  id: string;
  state: ModuleState;
  /** Typed manifest when parsing succeeded; null for `invalid`. */
  manifest: ModuleManifest | null;
  /** Human-readable reasons for invalid/incompatible; empty otherwise. */
  errors: string[];
}

export interface ModuleTab {
  /** `${manifest.id}/${ui.id}` — unique per registered tab. */
  tabKey: string;
  entry: ModuleEntry;
  tab: ModuleUiEntry;
}

function entryId(raw: unknown): string {
  if (raw !== null && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'unknown';
}

export function registerModules(raws: readonly unknown[]): ModuleEntry[] {
  const entries: ModuleEntry[] = [];
  const seenIds = new Set<string>();

  raws.forEach((raw, index) => {
    const key = `module-${index}`;
    const parsed = parseModuleManifest(raw);

    if (!parsed.ok) {
      entries.push({
        key,
        id: entryId(raw),
        state: parsed.stage === 'compatibility' ? 'incompatible' : 'invalid',
        manifest: null,
        errors: parsed.errors,
      });
      return;
    }

    if (seenIds.has(parsed.manifest.id)) {
      entries.push({
        key,
        id: parsed.manifest.id,
        state: 'invalid',
        manifest: null,
        errors: [`duplicate id: module "${parsed.manifest.id}" is already registered`],
      });
      return;
    }

    seenIds.add(parsed.manifest.id);
    entries.push({
      key,
      id: parsed.manifest.id,
      state: 'enabled',
      manifest: parsed.manifest,
      errors: [],
    });
  });

  return entries;
}

/**
 * Toggle a module by id. Only `enabled|disabled` entries move; `invalid` and
 * `incompatible` entries are not promotable — the app must surface the reason
 * instead of silently activating a broken module.
 */
export function setModuleEnabled(
  entries: readonly ModuleEntry[],
  id: string,
  enabled: boolean,
): ModuleEntry[] {
  return entries.map((entry) => {
    if (entry.manifest?.id !== id) return entry;
    if (entry.state !== 'enabled' && entry.state !== 'disabled') return entry;
    const next: ModuleState = enabled ? 'enabled' : 'disabled';
    return next === entry.state ? entry : { ...entry, state: next };
  });
}

/** Tab projection for the renderer: enabled modules only. */
export function moduleTabs(entries: readonly ModuleEntry[]): ModuleTab[] {
  const tabs: ModuleTab[] = [];
  for (const entry of entries) {
    if (entry.state !== 'enabled' || !entry.manifest) continue;
    for (const tab of entry.manifest.ui) {
      if (tab.kind !== 'tab') continue;
      tabs.push({ tabKey: `${entry.manifest.id}/${tab.id}`, entry, tab });
    }
  }
  return tabs;
}
