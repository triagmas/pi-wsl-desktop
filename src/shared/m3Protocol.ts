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
  /** Optional destination/payload for `openTab`, `openPanel`, `copyText`. */
  target: z.string().min(1).max(128).optional(),
});
export type ModuleAction = z.infer<typeof ModuleActionSchema>;

/**
 * Collection caps (R04): external raws can be arbitrarily large, so every
 * unbounded manifest array/record has a hard ceiling BEFORE anything
 * downstream (registry entries, diagnostics, IPC frames) sees the input.
 * Existing R01–R03 manifests are far below these limits.
 */
export const MAX_UI_ENTRIES = 64;
export const MAX_ACTIONS = 64;
export const MAX_DEPENDENCIES = 128;
export const MAX_PARAMS_KEYS = 64;

export const ModuleManifestSchema = z
  .object({
    id: ModuleIdSchema,
    version: SemverSchema,
    apiVersion: z.number().int().positive(),
    capabilities: z.array(z.enum(MODULE_CAPABILITIES)).min(1),
    ui: z.array(ModuleUiEntrySchema).min(1).max(MAX_UI_ENTRIES),
    actions: z.array(ModuleActionSchema).max(MAX_ACTIONS).default([]),
    dependencies: z.array(z.union([ModuleIdSchema, ModuleDependencySchema])).max(MAX_DEPENDENCIES).default([]),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  })
  .superRefine((manifest, ctx) => {
    if (Object.keys(manifest.params).length > MAX_PARAMS_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['params'],
        message: `params: must contain at most ${MAX_PARAMS_KEYS} keys`,
      });
    }
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

/** Full semver parse: MAJOR.MINOR.PATCH with optional pre-release. Core
 * numbers are BigInt so identifiers beyond 2^53 never collapse (the R03
 * `Number()` version compared 9007199254740993 and …92 as equal). */
interface ParsedVersion {
  major: bigint;
  minor: bigint;
  patch: bigint;
  /** Pre-release identifiers without the leading `-`, or null for a release. */
  pre: string[] | null;
}

const SEMVER_CORE_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER_CORE_RE.exec(value);
  if (!match) return null;
  return {
    major: BigInt(match[1]!),
    minor: BigInt(match[2]!),
    patch: BigInt(match[3]!),
    pre: match[4] !== undefined ? match[4].split('.') : null,
  };
}

/** Semver precedence for one identifier: numeric (BigInt) below alphanumeric. */
function comparePreId(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Pre-release precedence: a release outranks any pre-release; shorter list is lower. */
function comparePre(left: string[] | null, right: string[] | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const result = comparePreId(x, y);
    if (result !== 0) return result;
  }
  return 0;
}

/** Total order over parsed versions (MAJOR.MINOR.PATCH, then pre-release). */
function compareParsed(left: ParsedVersion, right: ParsedVersion): number {
  return (left.major < right.major ? -1 : left.major > right.major ? 1 : 0)
    || (left.minor < right.minor ? -1 : left.minor > right.minor ? 1 : 0)
    || (left.patch < right.patch ? -1 : left.patch > right.patch ? 1 : 0)
    || comparePre(left.pre, right.pre);
}

/** Same MAJOR.MINOR.PATCH tuple and the same pre-release identity. */
function sameIdentity(left: ParsedVersion, right: ParsedVersion): boolean {
  return left.major === right.major
    && left.minor === right.minor
    && left.patch === right.patch
    && comparePre(left.pre, right.pre) === 0
    && (left.pre === null) === (right.pre === null);
}

/**
 * Minimal semver range check for module dependencies, node-semver-aligned for
 * the exact syntax the schema admits: `*`, `X.Y.Z[-pre]` and `^X.Y.Z[-pre]`.
 *
 * - exact: same MAJOR.MINOR.PATCH and the same pre-release identity
 *   (`1.0.0-beta.1` < `1.0.0`, so a pre-release never passes an exact release);
 * - caret: `^A.B.C` → same MAJOR when A>0; `^0.B.C` → same MAJOR+MINOR;
 *   `^0.0.C` → exact patch (`0.3.0` does NOT pass `^0.2.3`);
 * - prerelease versions satisfy a caret only when the base itself carries a
 *   pre-release of the SAME MAJOR.MINOR.PATCH tuple with precedence ≤ the
 *   version (`1.1.0-beta.1` does NOT pass `^1.0.0-beta.1`, node-semver's
 *   prerelease-tuple rule);
 * - all identifiers compare as BigInt — no precision loss beyond 2^53;
 * - unknown or malformed inputs fail closed; `*` keeps its documented
 *   any-version meaning (including pre-releases) for legacy string deps.
 */
export function satisfiesSemverRange(version: string, range: string): boolean {
  if (range === '*') return true;
  const caret = range.startsWith('^');
  const base = parseVersion(caret ? range.slice(1) : range);
  const current = parseVersion(version);
  if (!base || !current) return false;

  if (!caret) {
    return sameIdentity(base, current);
  }

  if (base.major > 0n) {
    if (current.major !== base.major) return false;
  } else if (base.minor > 0n) {
    if (current.major !== 0n || current.minor !== base.minor) return false;
  } else if (current.major !== 0n || current.minor !== 0n || current.patch !== base.patch) {
    return false;
  }

  if (current.pre !== null) {
    if (base.pre === null) return false;
    if (current.major !== base.major
      || current.minor !== base.minor
      || current.patch !== base.patch) return false;
  }
  return compareParsed(current, base) >= 0;
}
