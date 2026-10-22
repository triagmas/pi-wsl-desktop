/**
 * M3 R04 IPC contract (shared/m3Ipc.ts) — node-free, imported by the bridge,
 * the main-process whitelist layer and the sandboxed renderer.
 *
 * Two methods, both bridge-owned (Issue #10 / PR #11 R04):
 * - `listModules`    → read-only discovery + persisted state; params are an
 *   EMPTY strict object, so no caller-controlled path can ever reach the fs;
 *   the modules root is `join(home, MODULES_SUBDIR)` decided by the bridge.
 * - `setModuleState` → the M3 write boundary; strict {id, enabled} only.
 *   It persists Desktop app state under `$HOME/.pi-desktop` (NOT `~/.pi`,
 *   NOT Pi configuration): single-step, atomic, reversible by toggling back —
 *   no M2 plan/confirm ceremony applies to UI preference state.
 *
 * All bounds live here so every side enforces the SAME limits: oversized
 * files, too many files, oversized state and runaway diagnostics all fail
 * closed with bounded, human-readable strings.
 */
import { z } from 'zod';
import { ModuleIdSchema } from './m3Protocol';

/** App-owned directory under `$HOME` for external declarative manifests. */
export const MODULES_SUBDIR = '.pi-desktop/modules';
/** App-owned state file under `$HOME` (relative form used by the bridge). */
export const MODULE_STATE_SUBPATH = '.pi-desktop/module-state.json';

/** Hard byte cap for one manifest file. */
export const MAX_MODULE_FILE_BYTES = 65_536;
/** Hard cap on manifest files read per discovery call (lexicographic order). */
export const MAX_MODULE_FILES = 64;
/** Hard cap on bridge-level diagnostics returned in one result. */
export const MAX_MODULE_DIAGNOSTICS = 64;

/**
 * Serialized response budget for one listModules frame: 64 × 64KiB would
 * encode to ~4MiB against MAX_FRAME_BYTES (1MiB) and kill the bridge — the
 * bridge must fail closed instead (review P1, R04).
 */
export const MAX_RESULT_BUDGET_BYTES = 786_432; // 768 KiB
/** Hard byte cap for the persisted state file. */
export const MAX_STATE_FILE_BYTES = 262_144;
/** Hard cap on persisted module-state entries. */
export const MAX_STATE_MODULES = 512;
/** State file format version (written into the JSON document). */
export const STATE_FILE_VERSION = 1;

/**
 * Only plain `name.json` basenames are considered. Leading dots (hidden/tmp
 * files) and any character that could signal odd path shapes are excluded;
 * entries are joined to the bridge-owned root and re-checked with lstat
 * (regular file only, no symlinks) before opening.
 */
export const MODULE_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}\.json$/;

export const ListModulesParamsSchema = z.strictObject({});

export const ModuleFileSchema = z.object({
  file: z.string().min(1).max(80),
  status: z.enum(['ok', 'error']),
  /** Raw JSON (pre-schema) when status is 'ok'; the renderer's registry owns
   * schema validation so a schema-invalid manifest still shows as an honest
   * `invalid` entry instead of vanishing. */
  raw: z.unknown().optional(),
  /** File-level failures only (fs/JSON/encoding), bounded per file. */
  errors: z.array(z.string().min(1).max(600)).max(8).default([]),
});

export const ListModulesResultSchema = z.object({
  available: z.boolean(),
  files: z.array(ModuleFileSchema).max(MAX_MODULE_FILES),
  diagnostics: z.array(z.string().min(1).max(600)).max(MAX_MODULE_DIAGNOSTICS),
  state: z
    .record(ModuleIdSchema, z.boolean())
    .refine((state) => Object.keys(state).length <= MAX_STATE_MODULES, {
      message: `state must contain at most ${MAX_STATE_MODULES} entries`,
    }),
});

export type ListModulesResult = z.infer<typeof ListModulesResultSchema>;
export type ModuleFileEntry = z.infer<typeof ModuleFileSchema>;

export const SetModuleStateParamsSchema = z.strictObject({
  id: ModuleIdSchema,
  enabled: z.boolean(),
});
export type SetModuleStateParams = z.infer<typeof SetModuleStateParamsSchema>;

export const SetModuleStateResultSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});
export type SetModuleStateResult = z.infer<typeof SetModuleStateResultSchema>;

/** Persisted state document shape (`$HOME/.pi-desktop/module-state.json`). */
export const ModuleStateFileSchema = z.object({
  version: z.literal(STATE_FILE_VERSION),
  modules: z.record(
    ModuleIdSchema,
    z.object({ enabled: z.boolean() }),
  ),
});
export type ModuleStateFile = z.infer<typeof ModuleStateFileSchema>;
