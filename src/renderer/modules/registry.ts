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
import {
  parseModuleManifest,
  satisfiesSemverRange,
  type ModuleCapability,
  type ModuleManifest,
  type ModuleUiEntry,
} from '../../shared/m3Protocol';

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

/**
 * Capabilities this host build actually wires for modules (SPECIFICATION §5):
 * runtime (Status), sessions (Sessions/Chat), resources (Resources/M2).
 * A declaration outside this set is not a grant: `resolveCapabilities` is the
 * only path from "declared" to "offered", so a module asking for a service
 * the renderer does not implement fails closed instead of being trusted.
 */
export const HOST_CAPABILITIES: readonly ModuleCapability[] = [
  'sessions',
  'runtime',
  'resources',
];

/** Declared capabilities split into granted (host offers them) and missing. */
export function resolveCapabilities(
  declared: readonly ModuleCapability[],
  available: readonly ModuleCapability[],
): { granted: ModuleCapability[]; missing: ModuleCapability[] } {
  const offered = new Set<ModuleCapability>(available);
  const granted: ModuleCapability[] = [];
  const missing: ModuleCapability[] = [];
  for (const capability of declared) {
    (offered.has(capability) ? granted : missing).push(capability);
  }
  return { granted, missing };
}

interface DependencyRef {
  id: string;
  range: string;
}

/** Normalise the string (R01/R02) and object forms to one lookup shape. */
function dependencyRefs(manifest: ModuleManifest): DependencyRef[] {
  return manifest.dependencies.map((dependency) =>
    typeof dependency === 'string'
      ? { id: dependency, range: '*' }
      : { id: dependency.id, range: dependency.range },
  );
}

/**
 * Hard cap on diagnostics carried by one entry. BOTH direct causes (one per
 * declared dependency) and propagated causes (copied into every ancestor) go
 * through this helper: on wide graphs the count would otherwise grow linearly
 * per entry and, for propagated fan-in, double per level — `push(...hugeArray)`
 * then exceeds the JS argument limit and `registerModules` throws, breaking its
 * "never throws" contract. The cap bounds both memory and spread size; the
 * reason string is already capped at 512 chars, which limits WIDTH, not COUNT.
 */
const MAX_DIAGNOSTICS = 32;
const TRUNCATION_MARKER = '… further dependency diagnostics truncated';

function pushBounded(target: string[], incoming: readonly string[]): void {
  for (const message of incoming) {
    if (target.length >= MAX_DIAGNOSTICS) {
      if (target[target.length - 1] !== TRUNCATION_MARKER) target.push(TRUNCATION_MARKER);
      return;
    }
    target.push(message);
  }
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
        const dependency = dependencyRefs(manifest)[frame.next++]!;
        const name = dependency.id;
        const child = byId.get(name);
        if (!child) {
          pushBounded(frame.errors, ['dependency "' + name + '" is missing or invalid/incompatible']);
          continue;
        }
        if (child.state === 'disabled') {
          pushBounded(frame.errors, ['dependency "' + name + '": module disabled']);
          continue;
        }
        if (!satisfiesSemverRange(child.manifest!.version, dependency.range)) {
          pushBounded(frame.errors, [
            'dependency "' + name + '": requires ' + dependency.range
              + ', found ' + child.manifest!.version,
          ]);
          continue;
        }
        const cycleAt = active.get(name);
        if (cycleAt !== undefined) {
          const path = stack.slice(cycleAt, cycleAt + 12)
            .map((node) => node.entry.manifest!.id).join(' -> ');
          pushBounded(frame.errors, ['dependency cycle detected: ' + path + ' -> ' + name]);
          continue;
        }
        const previous = cached.get(name);
        if (previous) {
          if (!previous.ok) {
            pushBounded(
              frame.errors,
              previous.errors.map((err) => reason(name, err)),
            );
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
        pushBounded(
          parent.errors,
          outcome.errors.map((err) => reason(manifest.id, err)),
        );
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

export function registerModules(
  raws: readonly unknown[],
  options: { availableCapabilities?: readonly ModuleCapability[] } = {},
): ModuleEntry[] {
  const available = options.availableCapabilities ?? HOST_CAPABILITIES;
  const entries: ModuleEntry[] = [];
  const seenIds = new Set<string>();

  raws.forEach((raw, index) => {
    const key = `module-${index}`;
    const parsed = parseModuleManifest(raw);

    if (!parsed.ok) {
      // Parse diagnostics are bounded by the same cap: a schema-invalid
      // manifest can carry hundreds of issues (R04 external raws), and every
      // entry must honour the same "never explodes" budget.
      const errors: string[] = [];
      pushBounded(errors, parsed.errors);
      entries.push({
        key,
        id: entryId(raw),
        state: parsed.stage === 'compatibility' ? 'incompatible' : 'invalid',
        manifest: null,
        errors,
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
    const { missing } = resolveCapabilities(parsed.manifest.capabilities, available);
    if (missing.length > 0) {
      entries.push({
        key,
        id: parsed.manifest.id,
        state: 'incompatible',
        manifest: null,
        errors: missing.map(
          (capability) => `capability "${capability}" is not provided by the host`,
        ),
      });
      return;
    }
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

/** Panel projection for the renderer: enabled modules only, kind `panel`. */
export function modulePanels(entries: readonly ModuleEntry[]): ModuleTab[] {
  const panels: ModuleTab[] = [];
  for (const entry of entries) {
    if (entry.state !== 'enabled' || !entry.manifest) continue;
    for (const panel of entry.manifest.ui) {
      if (panel.kind !== 'panel') continue;
      panels.push({ tabKey: `${entry.manifest.id}/${panel.id}`, entry, tab: panel });
    }
  }
  return panels;
}
