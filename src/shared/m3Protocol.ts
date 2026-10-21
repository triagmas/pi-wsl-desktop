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

export const ModuleManifestSchema = z.object({
  id: ModuleIdSchema,
  version: SemverSchema,
  apiVersion: z.number().int().positive(),
  capabilities: z.array(z.enum(MODULE_CAPABILITIES)).min(1),
  ui: z.array(ModuleUiEntrySchema).min(1),
  dependencies: z.array(ModuleIdSchema).default([]),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
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
