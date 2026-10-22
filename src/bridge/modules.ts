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
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  MAX_MODULE_DIAGNOSTICS,
  MAX_MODULE_FILE_BYTES,
  MAX_MODULE_FILES,
  MODULE_FILE_NAME_RE,
  MODULES_SUBDIR,
  type ListModulesResult,
  type ModuleFileEntry,
} from '../shared/m3Ipc';

/** Absolute modules root for a given home (bridge-owned, no caller input). */
export function modulesRoot(home: string): string {
  return path.join(home, ...MODULES_SUBDIR.split('/'));
}

function errEntry(file: string, message: string): ModuleFileEntry {
  return { file, status: 'error', errors: [message.slice(0, 600)] };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

async function readManifestFile(root: string, name: string): Promise<ModuleFileEntry> {
  const full = path.join(root, name);
  let initial;
  try {
    initial = await fsp.lstat(full);
  } catch (error) {
    return errEntry(name, `unreadable: ${errorMessage(error)}`);
  }
  if (initial.isSymbolicLink()) return errEntry(name, 'symlink rejected (not a regular file)');
  if (!initial.isFile()) return errEntry(name, 'not a regular file');
  if (initial.size > MAX_MODULE_FILE_BYTES) {
    return errEntry(name, `file exceeds ${MAX_MODULE_FILE_BYTES} bytes`);
  }

  let handle;
  try {
    handle = await fsp.open(full, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    return errEntry(name, `unreadable: ${errorMessage(error)}`);
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
    root,
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

  let names: string[];
  try {
    names = (await fsp.readdir(root)).filter((name) => MODULE_FILE_NAME_RE.test(name)).sort();
  } catch (error) {
    addDiagnostic(`modules root unreadable: ${errorMessage(error)}`);
    return empty(false);
  }

  const overflow = names.length - MAX_MODULE_FILES;
  if (overflow > 0) {
    addDiagnostic(
      `module files limit (${MAX_MODULE_FILES}) reached; ${overflow} extra file(s) ignored`,
    );
    names = names.slice(0, MAX_MODULE_FILES);
  }

  const files: ModuleFileEntry[] = [];
  for (const name of names) {
    files.push(await readManifestFile(root, name));
  }

  return { root, available: true, files, diagnostics, state: {} };
}
