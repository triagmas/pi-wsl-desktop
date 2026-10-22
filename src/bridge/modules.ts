/**
 * M3 R04 bridge — external DECLARATIVE manifest discovery (read-only).
 *
 * Security posture (Issue #10 / PR #11 R04, SPEC §5-6):
 * - The root is bridge-owned: `join(home, .pi-desktop/modules)`. Callers pass
 *   NO path, so path traversal cannot be requested over IPC; after a realpath
 *   check the root must still live under realpath(home) (a symlinked root
 *   disables discovery with an honest diagnostic instead of following it).
 * - Only plain `name.json` entries matching MODULE_FILE_NAME_RE are read;
 *   hidden/odd names never reach the loop. Every candidate is lstat'ed:
 *   symlinks and non-regular files are rejected WITHOUT opening them, and the
 *   O_NOFOLLOW open plus an fstat re-check on the real descriptor closes the
 *   lstat→open window (size/symlink/retarget races fail closed).
 * - Bytes are capped at MAX_MODULE_FILE_BYTES (read at most one cap-worth),
 *   decoded as fatal UTF-8 and JSON-parsed per file — a broken file becomes a
 *   bounded per-file error, never a failed response and never a partial raw.
 * - Raw JSON is returned WITHOUT schema validation on purpose: the renderer's
 *   fail-closed registry owns the manifest schema stage so schema-invalid
 *   external files still show up as honest `invalid` entries in the UI.
 * - No file IO in the renderer, no JS import/execution anywhere: manifests
 *   stay data (SPEC §5: dynamic execution of untrusted JS is not 1.0).
 * - `state` is embedded here (Task 6 replaces the `{}` placeholder with the
 *   persisted enable/disable map read from the app-owned state file).
 */
import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { BridgeError } from '../shared/errors';
import { ModuleIdSchema } from '../shared/m3Protocol';
import {
  MAX_MODULE_DIAGNOSTICS,
  MAX_MODULE_FILE_BYTES,
  MAX_MODULE_FILES,
  MAX_STATE_FILE_BYTES,
  MAX_STATE_MODULES,
  MODULE_FILE_NAME_RE,
  MODULES_SUBDIR,
  MODULE_STATE_SUBPATH,
  STATE_FILE_VERSION,
  type ListModulesResult,
  type ModuleFileEntry,
  type SetModuleStateResult, MAX_RESULT_BUDGET_BYTES } from '../shared/m3Ipc';

/** Absolute modules root for a given home (bridge-owned, no caller input). */
export function modulesRoot(home: string): string {
  return path.join(home, ...MODULES_SUBDIR.split('/'));
}

function errEntry(file: string, message: string): ModuleFileEntry {
  return { file, status: 'error', errors: [message.slice(0, 600)] };
}

/**
 * FS error text for the bridge→renderer boundary: stable code + hint, NEVER
 * the raw `error.message` (Node embeds absolute paths in EACCES/ENOENT text —
 * caught by the R04 REAL smoke as a home-path leak).
 */
function fsErrorText(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? 'EUNKNOWN')
      : 'EUNKNOWN';
  const hints: Record<string, string> = {
    EACCES: 'permission denied',
    EPERM: 'permission denied',
    ENOENT: 'not found',
    ELOOP: 'symlink loop',
    EMFILE: 'too many file descriptors',
    ENFILE: 'system file table full',
    EISDIR: 'is a directory',
  };
  const hint = hints[code];
  return hint ? `${code}: ${hint}` : code;
}

async function readManifestFile(root: string, name: string): Promise<ModuleFileEntry> {
  const full = path.join(root, name);
  let initial;
  try {
    initial = await fsp.lstat(full);
  } catch (error) {
    return errEntry(name, `unreadable: ${fsErrorText(error)}`);
  }
  if (initial.isSymbolicLink()) return errEntry(name, 'symlink rejected (not a regular file)');
  if (!initial.isFile()) return errEntry(name, 'not a regular file');
  if (initial.size > MAX_MODULE_FILE_BYTES) {
    return errEntry(name, `file exceeds ${MAX_MODULE_FILE_BYTES} bytes`);
  }

  let handle;
  try {
    handle = await fsp.open(
      full,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    return errEntry(name, `unreadable: ${fsErrorText(error)}`);
  }
  try {
    // Re-check on the pinned descriptor: the size/type guards above observed a
    // different (or retargeted) inode if anything changed in between.
    const stat = await handle.stat();
    if (!stat.isFile()) return errEntry(name, 'not a regular file');
    if (stat.size > MAX_MODULE_FILE_BYTES) {
      return errEntry(name, `file exceeds ${MAX_MODULE_FILE_BYTES} bytes`);
    }
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      return errEntry(name, 'invalid UTF-8 encoding');
    }
    try {
      return { file: name, status: 'ok', raw: JSON.parse(text) as unknown, errors: [] };
    } catch {
      return errEntry(name, 'invalid JSON (not parseable)');
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Discover external manifests under the bridge-owned root. Never throws:
 * every failure becomes `available:false`, a bounded diagnostic or a bounded
 * per-file error entry. `state` is a placeholder until Task 6 wires the
 * persisted enable/disable map.
 */
export async function discoverModules(home: string): Promise<ListModulesResult> {
  const root = modulesRoot(home);
  const diagnostics: string[] = [];
  const addDiagnostic = (message: string): void => {
    if (diagnostics.length < MAX_MODULE_DIAGNOSTICS) diagnostics.push(message.slice(0, 600));
  };
  const empty = (available: boolean): ListModulesResult => ({
    available,
    files: [],
    diagnostics,
    state: {},
  });

  let realHome: string;
  try {
    realHome = await fsp.realpath(home);
  } catch {
    return empty(false);
  }
  let realRoot: string;
  try {
    realRoot = await fsp.realpath(root);
  } catch {
    return empty(false);
  }
  const relative = path.relative(realHome, realRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    addDiagnostic('modules root escapes the home directory (symlink); discovery disabled');
    return empty(false);
  }

  // Component pinning (review P1): containment alone still allows a symlinked
  // root/.pi-desktop pointing at ANOTHER directory inside home (e.g. a symlink
  // to `~/.pi/agent` would ship auth.json as a "manifest"). Every component
  // that must exist has to be a REAL directory; all later operations then use
  // that proven path. (Parent retarget by a writer of $HOME between this check
  // and open remains a disclosed same-user residual — see ROADMAP R04.)
  for (const [label, component] of [
    ['app state directory', path.join(home, '.pi-desktop')],
    ['modules root', root],
  ] as const) {
    try {
      const st = await fsp.lstat(component);
      if (!st.isDirectory() || st.isSymbolicLink()) {
        addDiagnostic(`${label} is not a real directory (symlink); discovery disabled`);
        return empty(false);
      }
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') continue; // fresh install paths
      addDiagnostic(`${label} unreadable: ${fsErrorText(error)}`);
      return empty(false);
    }
  }

  let names: string[];
  try {
    names = (await fsp.readdir(root)).filter((name) => MODULE_FILE_NAME_RE.test(name)).sort();
  } catch (error) {
    addDiagnostic(`modules root unreadable: ${fsErrorText(error)}`);
    return empty(false);
  }

  const overflow = names.length - MAX_MODULE_FILES;
  if (overflow > 0) {
    addDiagnostic(
      `module files limit (${MAX_MODULE_FILES}) reached; ${overflow} extra file(s) ignored`,
    );
    names = names.slice(0, MAX_MODULE_FILES);
  }

  // Response budget (review P1): 64 × 64KiB would encode to ~4MiB against a
  // 1MiB transport frame — the encode would kill the bridge instead of
  // failing closed. Total payload bytes are capped with an honest diagnostic.
  const files: ModuleFileEntry[] = [];
  let usedBytes = 0;
  let omitted = 0;
  for (const name of names) {
    const entry = await readManifestFile(root, name);
    const size = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 32;
    if (usedBytes + size > MAX_RESULT_BUDGET_BYTES) {
      omitted += 1;
      continue;
    }
    usedBytes += size;
    files.push(entry);
  }
  if (omitted > 0) {
    addDiagnostic(`manifest response budget exceeded; ${omitted} file(s) omitted`);
  }

  return { available: true, files, diagnostics, state: {} };
}

/* ------------------------------------------------------------------ */
/* Enable/disable persistence — Desktop app state under `$HOME/.pi-desktop`
 * (NOT `~/.pi`, NOT Pi configuration). Fail-closed rules:
 * - the state directory must not be a symlink (it would redirect writes
 *   outside home through path components lstat cannot see);
 * - the state file must be a regular non-symlink file within the size cap;
 * - unreadable/unsupported/malformed documents are never overwritten: reads
 *   degrade to an empty map with one bounded diagnostic, writes refuse with
 *   INVALID_REQUEST (bytes stay untouched — no silent data destruction);
 * - merges preserve unknown top-level keys, unknown module ids and unknown
 *   per-module fields (only `enabled` is managed);
 * - writes are serialized in-process and atomic (tmp file + rename), so
 *   concurrent toggles cannot lose an id; rename never follows a symlink
 *   that races in after the guard check.
 * ------------------------------------------------------------------ */

export function stateFilePath(home: string): string {
  return path.join(home, ...MODULE_STATE_SUBPATH.split('/'));
}

interface StateInspection {
  /** Parsed enable/disable map (empty when absent or unusable). */
  state: Record<string, boolean>;
  /** Raw document to merge into; null when the file must not be written. */
  base: Record<string, unknown> | null;
  /** Why the file is unusable, or null when absent/valid. */
  problem: string | null;
}

async function readPinned(handle: import('node:fs/promises').FileHandle): Promise<Buffer | null> {
  const stat = await handle.stat();
  if (!stat.isFile()) return null;
  if (stat.size > MAX_STATE_FILE_BYTES) return null;
  const buffer = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

async function inspectState(home: string): Promise<StateInspection> {
  const file = stateFilePath(home);
  const dir = path.dirname(file);

  let dirStat;
  try {
    dirStat = await fsp.lstat(dir);
  } catch {
    return { state: {}, base: null, problem: null }; // no app dir yet — normal
  }
  if (dirStat.isSymbolicLink()) {
    return { state: {}, base: null, problem: 'app state directory is a symlink' };
  }
  if (!dirStat.isDirectory()) {
    return { state: {}, base: null, problem: 'app state path is not a directory' };
  }

  let stat;
  try {
    stat = await fsp.lstat(file);
  } catch {
    return { state: {}, base: null, problem: null }; // no state yet — normal
  }
  if (stat.isSymbolicLink()) {
    return { state: {}, base: null, problem: 'module state file is a symlink' };
  }
  if (!stat.isFile()) {
    return { state: {}, base: null, problem: 'module state path is not a regular file' };
  }
  if (stat.size > MAX_STATE_FILE_BYTES) {
    return { state: {}, base: null, problem: `module state file exceeds ${MAX_STATE_FILE_BYTES} bytes` };
  }

  let handle;
  try {
    handle = await fsp.open(
      file,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    return { state: {}, base: null, problem: `module state unreadable: ${fsErrorText(error)}` };
  }
  try {
    const buffer = await readPinned(handle);
    if (!buffer) {
      return { state: {}, base: null, problem: 'module state unreadable (pinned descriptor rejected)' };
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return { state: {}, base: null, problem: 'module state unreadable: invalid UTF-8 encoding' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { state: {}, base: null, problem: 'module state unreadable: invalid JSON' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: {}, base: null, problem: 'module state malformed (not an object)' };
    }
    const doc = parsed as Record<string, unknown>;
    if (doc.version !== undefined && doc.version !== STATE_FILE_VERSION) {
      return { state: {}, base: null, problem: 'module state has an unsupported version (state ignored)' };
    }
    const rawModules = doc.modules ?? {};
    if (rawModules === null || typeof rawModules !== 'object' || Array.isArray(rawModules)) {
      return { state: {}, base: null, problem: 'module state malformed (modules)' };
    }
    const state: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(rawModules as Record<string, unknown>)) {
      if (!ModuleIdSchema.safeParse(id).success) {
        return { state: {}, base: null, problem: 'module state contains an invalid module id (state ignored)' };
      }
      if (value === null || typeof value !== 'object'
        || typeof (value as { enabled?: unknown }).enabled !== 'boolean') {
        return { state: {}, base: null, problem: 'module state entry is malformed (state ignored)' };
      }
      state[id] = (value as { enabled: boolean }).enabled;
    }
    if (Object.keys(state).length > MAX_STATE_MODULES) {
      return { state: {}, base: null, problem: `module state exceeds ${MAX_STATE_MODULES} entries` };
    }
    return { state, base: doc, problem: null };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Read the persisted map for discovery results; problems become ONE bounded diagnostic. */
export async function readModuleState(
  home: string,
): Promise<{ state: Record<string, boolean>; diagnostics: string[] }> {
  const inspection = await inspectState(home);
  return {
    state: inspection.state,
    diagnostics: inspection.problem
      ? [`module state: ${inspection.problem}; ignored (fail-closed)`.slice(0, 600)]
      : [],
  };
}

let stateWriteChain: Promise<unknown> = Promise.resolve();

/**
 * Persist one toggle. Serialized in-process (parallel toggles cannot lose an
 * id) and atomic (tmp + rename). Refuses with `INVALID_REQUEST` whenever the
 * existing document cannot be read safely — a corrupt/symlinked/oversized
 * file is never silently replaced.
 */
export function writeModuleState(
  home: string,
  id: string,
  enabled: boolean,
): Promise<SetModuleStateResult> {
  const operation = stateWriteChain.then(
    () => performStateWrite(home, id, enabled),
    () => performStateWrite(home, id, enabled),
  );
  stateWriteChain = operation.catch(() => undefined);
  return operation;
}

async function performStateWrite(
  home: string,
  id: string,
  enabled: boolean,
): Promise<SetModuleStateResult> {
  const file = stateFilePath(home);
  const dir = path.dirname(file);
  const inspection = await inspectState(home);
  if (inspection.problem) {
    throw new BridgeError('INVALID_REQUEST', `setModuleState: ${inspection.problem}`);
  }

  const modules = (inspection.base?.modules ?? {}) as Record<string, unknown>;
  const nextModules: Record<string, unknown> = { ...modules };
  const existing = nextModules[id];
  nextModules[id] = existing !== null && typeof existing === 'object'
    ? { ...(existing as Record<string, unknown>), enabled }
    : { enabled };
  if (Object.keys(nextModules).length > MAX_STATE_MODULES) {
    throw new BridgeError(
      'INVALID_REQUEST',
      `setModuleState: state module limit (${MAX_STATE_MODULES}) reached`,
    );
  }

  const document = { ...(inspection.base ?? {}), version: STATE_FILE_VERSION, modules: nextModules };
  const payload = JSON.stringify(document);
  if (Buffer.byteLength(payload, 'utf8') > MAX_STATE_FILE_BYTES) {
    throw new BridgeError(
      'INVALID_REQUEST',
      `setModuleState: state would exceed ${MAX_STATE_FILE_BYTES} bytes`,
    );
  }

  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new BridgeError('UNKNOWN', `setModuleState: cannot create app state directory (${fsErrorText(error)})`);
  }
  // Exclusive random tmp (review P1): 'wx' refuses to open ANY existing path
  // component (a planted symlink is never followed, the target never
  // truncated), and the random suffix removes the predictable name.
  const tmp = path.join(
    dir,
    `.state-tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`,
  );
  try {
    await fsp.writeFile(tmp, payload, { mode: 0o600, flag: 'wx' });
    await fsp.rename(tmp, file);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw new BridgeError('UNKNOWN', `setModuleState: write failed (${fsErrorText(error)})`);
  }
  return { id, enabled };
}
