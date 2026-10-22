/**
 * M3 module contract (shared/m3Protocol.ts) — node-free, imported by BOTH the
 * main-side code and the sandboxed renderer, so it must never pull node-only
 * APIs into the web bundle (same rule as shared/codes.ts).
 *
 * Authority: SPECIFICATION.md §5 — every module declares id, version,
 * apiVersion, UI entry points, capabilities, dependencies and parameters.
 * Dynamic execution of untrusted JS is explicitly NOT part of 1.0, so a
 * module here is a declarative manifest only: validated fail-closed before
 * anything downstream (registry, renderer) sees it.
 *
 * Two distinct failure stages so the UI can show an honest reason:
 * - `manifest`        → shape/capability/block violations (Zod safeParse),
 * - `compatibility`   → apiVersion mismatch against the host MODULE_API_VERSION.
 */
import { z } from 'zod';

/** Host module API version. Bump on a breaking manifest/contract change. */
export const MODULE_API_VERSION = 1;

/** Core services (SPECIFICATION §5) a module may declare as capabilities. */
export const MODULE_CAPABILITIES = [
  'sessions',
  'runtime',
  'resources',
  'notifications',
  'settings',
] as const;
export type ModuleCapability = (typeof MODULE_CAPABILITIES)[number];

/**
 * Explicit whitelist of module operations (SPECIFICATION §5, PRODUCT §3.4).
 * A module may only ask for these — a declaration outside this list is a
 * malformed manifest, not a request the host might silently honour.
 */
export const MODULE_OPERATIONS = ['openTab', 'openPanel', 'refresh', 'copyText'] as const;
export type ModuleOperation = (typeof MODULE_OPERATIONS)[number];

/* ------------------------------------------------------------------ */
/* UI blocks — a tiny declarative vocabulary, NOT a rendering framework */
/* ------------------------------------------------------------------ */

const TextBlockSchema = z.object({
  type: z.literal('text'),
  value: z.string().min(1).max(2000),
});

const KvBlockSchema = z.object({
  type: z.literal('kv'),
  entries: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        value: z.string().max(500),
      }),
    )
    .min(1)
    .max(50),
});

const ListBlockSchema = z.object({
  type: z.literal('list'),
  items: z.array(z.string().min(1).max(500)).min(1).max(100),
});

export const ModuleBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  KvBlockSchema,
  ListBlockSchema,
]);
export type ModuleBlock = z.infer<typeof ModuleBlockSchema>;

/** UI entry points (SPECIFICATION §5): tab and panel contributions. */
export const ModuleUiEntrySchema = z.object({
  kind: z.enum(['tab', 'panel']),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  title: z.string().min(1).max(80),
  blocks: z.array(ModuleBlockSchema).min(1),
});
export type ModuleUiEntry = z.infer<typeof ModuleUiEntrySchema>;

/** Strict slug for the module id — also the registry key. */
const ModuleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);

/** Minimal semver: MAJOR.MINOR.PATCH with optional pre-release. */
const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

/**
 * Dependency with an optional semver constraint. The plain-string form from
 * R01/R02 stays valid; the object form adds a range the host must check.
 */
const ModuleDependencySchema = z.object({
  id: ModuleIdSchema,
  range: z
    .string()
    .max(64)
    .regex(/^(?:\*|\^?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
      'range must be *, X.Y.Z or ^X.Y.Z'),
});

export const ModuleActionSchema = z.object({
  id: ModuleIdSchema,
  title: z.string().min(1).max(80),
  operation: z.enum(MODULE_OPERATIONS),
});
export type ModuleAction = z.infer<typeof ModuleActionSchema>;

export const ModuleManifestSchema = z
  .object({
    id: ModuleIdSchema,
    version: SemverSchema,
    apiVersion: z.number().int().positive(),
    capabilities: z.array(z.enum(MODULE_CAPABILITIES)).min(1),
    ui: z.array(ModuleUiEntrySchema).min(1),
    actions: z.array(ModuleActionSchema).default([]),
    dependencies: z.array(z.union([ModuleIdSchema, ModuleDependencySchema])).default([]),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  })
  .superRefine((manifest, ctx) => {
    // Duplicate ui entry ids would project colliding tabKeys / React keys,
    // silently making the second contribution unreachable — fail closed.
    const seen = new Set<string>();
    manifest.ui.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ui', index, 'id'],
          message: `duplicate ui id: "${entry.id}" is declared more than once`,
        });
      }
      seen.add(entry.id);
    });
  });
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export type ManifestParseResult =
  | { ok: true; manifest: ModuleManifest }
  | { ok: false; stage: 'manifest' | 'compatibility'; errors: string[] };

/**
 * Parse + validate a raw manifest. Never throws: any input shape is either
 * accepted as a typed manifest or returned with human-readable errors.
 */
export function parseModuleManifest(raw: unknown): ManifestParseResult {
  const parsed = ModuleManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      stage: 'manifest',
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `${path}: ${issue.message}`;
      }),
    };
  }

  const manifest = parsed.data;
  if (manifest.apiVersion !== MODULE_API_VERSION) {
    return {
      ok: false,
      stage: 'compatibility',
      errors: [
        `apiVersion: module declares ${manifest.apiVersion}, host supports ${MODULE_API_VERSION}`,
      ],
    };
  }

  return { ok: true, manifest };
}

/**
 * Minimal semver range check for module dependencies: `*`, exact `X.Y.Z`
 * and caret `^X.Y.Z` (same major, at least the base version). Unknown or
 * malformed inputs fail closed — a dependency the host cannot evaluate must
 * not be treated as satisfied.
 */
function numericVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function satisfiesSemverRange(version: string, range: string): boolean {
  if (range === '*') return true;
  const caret = range.startsWith('^');
  const base = numericVersion(caret ? range.slice(1) : range);
  const current = numericVersion(version);
  if (!base || !current) return false;
  const delta = current[0] - base[0] || current[1] - base[1] || current[2] - base[2];
  if (!caret) return delta === 0;
  return current[0] === base[0] && delta >= 0;
}
