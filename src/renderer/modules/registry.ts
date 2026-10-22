/**
 * M3 module registry (renderer-side, pure) — registration, enable/disable and
 * the tab projection the App renders through ONE generic contract.
 *
 * Invariants (SPECIFICATION §5, PRODUCT §3.4):
 * - `registerModules` NEVER throws: every raw value becomes exactly one entry
 *   with an honest state (`enabled | disabled | invalid | incompatible`);
 * - a duplicate id fails the LATER registration closed, the first stands;
 * - only `enabled` entries project tabs — invalid/incompatible modules can
 *   never put UI on screen, and dependency-blocked modules fail closed;
 * - no file IO, imports of external module code or capability elevation;
 * - adding a module must not require patching the core: App maps over
 *   `moduleTabs()` output.
 */
import { parseModuleManifest, type ModuleManifest, type ModuleUiEntry } from '../../shared/m3Protocol';

export type ModuleState = 'enabled' | 'disabled' | 'blocked' | 'invalid' | 'incompatible';

export interface ModuleEntry {
  /** Stable per-registration key (survives duplicate ids). */
  key: string;
  /** Declared module id, or a best-effort fallback for unparseable raws. */
  id: string;
  state: ModuleState;
  /** Typed manifest when parsing succeeded; null for `invalid`. */
  manifest: ModuleManifest | null;
  /** Human-readable reasons for invalid/incompatible/blocked; empty otherwise. */
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

/**
 * Recompute dependency availability from the whole registry. Dependencies
 * are declarative: they never load arbitrary code or grant capabilities.
 * A dependent may contribute UI only when every declared provider exists,
 * is compatible and is enabled. Disabled entries represent explicit user
 * intent; a blocked entry automatically recovers when its providers return.
 *
 * Lookups are order independent. DFS detects cycles rather than admitting
 * an unreachable dependency graph. This function only operates on manifests
 * already accepted by parseModuleManifest (no file IO / Pi mutations).
 */
function reconcileDependencies(entries: readonly ModuleEntry[]): ModuleEntry[] {
  const byId = new Map<string, ModuleEntry>();
  for (const entry of entries) {
    if (entry.manifest && entry.state !== 'invalid' && entry.state !== 'incompatible') {
      byId.set(entry.manifest.id, entry);
    }
  }
  type Resolution = { ok: boolean; errors: string[] };
  type Frame = { entry: ModuleEntry; next: number; errors: string[] };
  const cached = new Map<string, Resolution>();

  const reason = (name: string, cause: string): string => {
    const message = 'dependency "' + name + '": ' + cause;
    if (message.length <= 512) return message;
    const kind = cause.includes('cycle') ? 'dependency cycle detected'
      : cause.includes('disabled') ? 'module disabled'
      : cause.includes('missing') ? 'dependency missing/incompatible'
      : 'dependency unavailable';
    return 'dependency "' + name + '": ' + kind + ' (details truncated)';
  };

  const resolve = (root: ModuleEntry): Resolution => {
    const stack: Frame[] = [];
    const active = new Map<string, number>();
    const visit = (entry: ModuleEntry): void => {
      active.set(entry.manifest!.id, stack.length);
      stack.push({ entry, next: 0, errors: [] });
    };

    visit(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const manifest = frame.entry.manifest!;
      if (frame.next < manifest.dependencies.length) {
        const dependency = manifest.dependencies[frame.next++]!;
        const child = byId.get(dependency);
        if (!child) {
          frame.errors.push('dependency "' + dependency + '" is missing or invalid/incompatible');
          continue;
        }
        if (child.state === 'disabled') {
          frame.errors.push('dependency "' + dependency + '": module disabled');
          continue;
        }
        const cycleAt = active.get(dependency);
        if (cycleAt !== undefined) {
          const path = stack.slice(cycleAt, cycleAt + 12)
            .map((node) => node.entry.manifest!.id).join(' -> ');
          frame.errors.push('dependency cycle detected: ' + path + ' -> ' + dependency);
          continue;
        }
        const previous = cached.get(dependency);
        if (previous) {
          if (!previous.ok) {
            frame.errors.push(...previous.errors.map((err) => reason(dependency, err)));
          }
          continue;
        }
        visit(child);
        continue;
      }
      const outcome: Resolution = { ok: frame.errors.length === 0, errors: frame.errors };
      cached.set(manifest.id, outcome);
      stack.pop();
      active.delete(manifest.id);
      const parent = stack[stack.length - 1];
      if (parent && !outcome.ok) {
        parent.errors.push(...outcome.errors.map((err) => reason(manifest.id, err)));
      }
    }
    return cached.get(root.manifest!.id)!;
  };

  return entries.map((entry): ModuleEntry => {
    if (!entry.manifest || entry.state === 'invalid' || entry.state === 'incompatible') {
      return entry;
    }
    if (entry.state === 'disabled') return entry;
    const result = cached.get(entry.manifest.id) ?? resolve(entry);
    return result.ok
      ? { ...entry, state: 'enabled', errors: [] }
      : { ...entry, state: 'blocked', errors: result.errors };
  });
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

  return reconcileDependencies(entries);
}

/**
 * Toggle a module by id. Valid entries may also be temporarily blocked by
 * dependencies; invalid/incompatible entries are never promotable. Every
 * toggle re-evaluates the whole dependency graph to hide blocked tabs.
 */
export function setModuleEnabled(
  entries: readonly ModuleEntry[],
  id: string,
  enabled: boolean,
): ModuleEntry[] {
  const toggled = entries.map((entry) => {
    if (entry.manifest?.id !== id) return entry;
    if (entry.state !== 'enabled' && entry.state !== 'disabled' && entry.state !== 'blocked') return entry;
    const next: ModuleState = enabled ? 'enabled' : 'disabled';
    return next === entry.state ? entry : { ...entry, state: next, errors: [] };
  });
  return reconcileDependencies(toggled);
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
