/**
 * Read-only session INDEX (M1, SPEC §3.2/§4.1).
 *
 * Scans Pi session roots for `*.jsonl` files and derives projects from the
 * header `cwd` — the ONLY authoritative project key, because the on-disk
 * bucket encoding (`--a-b-c--`) is lossy and collision-prone.
 *
 * Rules encoded here:
 * - Never write: this module only readdirs/stats/reads heads and tails.
 * - Never guess paths back out of bucket names (decodeBucketCollisionSafe
 *   refuses — callers must treat corrupt-header sessions as belonging to the
 *   bucket directory itself, honestly, instead of inventing a cwd).
 * - Nested transcripts (`<session>/<uuid>/run-0/session.jsonl`,
 *   `subagent-artifacts/`) are internal to Pi and NOT resumable sessions:
 *   they are skipped.
 * - Errors are per-file diagnostics; one broken file/bucket never breaks the
 *   whole index.
 * - `activeWrite` is a fail-safe heuristic (mtime within the window ⇒ a CLI
 *   may be appending right now); the bridge turns it into SESSION_CONFLICT
 *   instead of risking concurrent modification.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ProjectInfoT, SessionInfoT } from '../shared/m1Protocol';

export interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
export interface FileMeta {
  size: number;
  mtimeMs: number;
}
export interface FsLike {
  readdir(dir: string): Promise<DirEntry[]>;
  stat(p: string): Promise<FileMeta>;
  readHead(p: string, maxBytes: number): Promise<string>;
  readTail(p: string, maxBytes: number): Promise<string>;
}

const HEADER_MAX = 64 * 1024;

/** Real fs adapter (POSIX semantics — the bridge runs inside WSL). */
export const nodeFs: FsLike = {
  async readdir(dir) {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    return items.map((d) => ({ name: d.name, isDirectory: () => d.isDirectory(), isFile: () => d.isFile() }));
  },
  async stat(p) {
    const s = await fsp.stat(p);
    return { size: s.size, mtimeMs: s.mtimeMs };
  },
  async readHead(p, maxBytes) {
    const fh = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  },
  async readTail(p, maxBytes) {
    const s = await fsp.stat(p);
    const offset = Math.max(0, s.size - maxBytes);
    const fh = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, s.size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  },
};

export type SessionRootSource = 'env' | 'settings' | 'default';

export interface ResolveRootsInput {
  fs: FsLike;
  env: Record<string, string | undefined>;
  home: string;
}

export interface ResolveRootsResult {
  roots: string[];
  sources: Record<string, SessionRootSource>;
  diagnostics: string[];
}

/**
 * Session roots: PI_CODING_AGENT_SESSION_DIR > settings.sessionDir > default.
 * (SPEC §3.2 precedence; `--session-dir` is the CLI counterpart of the env var
 * for interactive runs and does not apply to an already-running bridge.)
 */
export async function resolveSessionRoots(input: ResolveRootsInput): Promise<ResolveRootsResult> {
  const { fs, env, home } = input;
  const diagnostics: string[] = [];
  const envDir = (env.PI_CODING_AGENT_SESSION_DIR ?? '').trim();
  if (envDir) return { roots: [envDir], sources: { [envDir]: 'env' }, diagnostics };

  const settingsPath = path.posix.join(home, '.pi', 'agent', 'settings.json');
  try {
    const raw = await fs.readHead(settingsPath, HEADER_MAX);
    const parsed = JSON.parse(raw) as { sessionDir?: unknown };
    const sd = typeof parsed.sessionDir === 'string' ? parsed.sessionDir.trim() : '';
    if (sd) return { roots: [sd], sources: { [sd]: 'settings' }, diagnostics };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ENOENT') {
      diagnostics.push(`settings ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const def = path.posix.join(home, '.pi', 'agent', 'sessions');
  return { roots: [def], sources: { [def]: 'default' }, diagnostics };
}

/**
 * Bucket names encode a path lossily (`/`,`\`,`:` → `-`), so reversing one
 * cannot distinguish `/a/b-c` from `/a-b/c`. Refuse instead of guessing.
 */
export function decodeBucketCollisionSafe(bucket: string): string | null {
  void bucket; // deliberately unused: reversing the lossy encoding is forbidden
  return null;
}

export interface BuildIndexInput {
  fs: FsLike;
  env: Record<string, string | undefined>;
  home: string;
  /** Fixed clock (ms epoch) for deterministic tests. */
  now?: number;
  activeWindowMs?: number;
  /** Test/production override; skips root resolution but keeps diagnostics. */
  rootsOverride?: string[];
}

export interface SessionIndex {
  projects: ProjectInfoT[];
  sessions: SessionInfoT[];
  diagnostics: string[];
}

interface HeaderInfo {
  id: string | null;
  /** Guaranteed absolute: parseHeader rejects headers without one. */
  cwd: string;
  version: number;
  timestamp: string | null;
}

function parseHeader(head: string): { header: HeaderInfo | null; error: string | null } {
  const nl = head.indexOf('\n');
  const line = nl === -1 ? head : head.slice(0, nl);
  if (line.trim() === '') return { header: null, error: 'empty header line' };
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    return { header: null, error: `invalid json: ${err instanceof Error ? err.message : String(err)}` };
  }
  const h = raw as Record<string, unknown>;
  if (h?.type !== 'session') return { header: null, error: 'missing session header type' };
  const version = typeof h.version === 'number' && h.version >= 1 ? h.version : 1;
  const cwd = typeof h.cwd === 'string' && h.cwd.startsWith('/') ? h.cwd : null;
  if (!cwd) return { header: null, error: 'header missing absolute cwd' };
  return {
    header: {
      id: typeof h.id === 'string' && h.id.length > 0 ? h.id : null,
      cwd,
      version,
      timestamp: typeof h.timestamp === 'string' ? h.timestamp : null,
    },
    error: null,
  };
}

/** Best-effort display name: scan the file TAIL for the last session_info entry. */
async function readDisplayName(fs: FsLike, file: string): Promise<string | null> {
  try {
    const tail = await fs.readTail(file, HEADER_MAX);
    const lines = tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line.includes('"session_info"')) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; name?: unknown };
        if (entry.type === 'session_info' && typeof entry.name === 'string' && entry.name.length > 0) {
          return entry.name;
        }
      } catch {
        /* partial/corrupt tail line — keep scanning upward */
      }
    }
  } catch {
    /* name extraction is best-effort */
  }
  return null;
}

export async function buildSessionIndex(input: BuildIndexInput): Promise<SessionIndex> {
  const { fs } = input;
  const nowMs = input.now ?? Date.now();
  const window = input.activeWindowMs ?? 10_000;
  const diagnostics: string[] = [];

  let roots: string[];
  if (input.rootsOverride) {
    roots = input.rootsOverride;
  } else {
    const resolved = await resolveSessionRoots({ fs, env: input.env, home: input.home });
    roots = resolved.roots;
    diagnostics.push(...resolved.diagnostics);
  }

  const sessions: SessionInfoT[] = [];

  const processFile = async (file: string, root: string, bucket: string): Promise<void> => {
    let meta: FileMeta | null = null;
    let head = '';
    let readError: string | null = null;
    try {
      meta = await fs.stat(file);
      if (meta.size > 0) head = await fs.readHead(file, HEADER_MAX);
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
    }

    const projectName = path.posix.basename(file, '.jsonl');
    const bucketDir = bucket === '(root)' ? root : path.posix.join(root, bucket);

    if (readError) {
      sessions.push({
        id: projectName,
        file,
        root,
        projectId: bucketDir,
        projectPath: bucketDir,
        name: null,
        createdAt: null,
        updatedAt: new Date(meta?.mtimeMs ?? 0).toISOString(),
        sizeBytes: meta?.size ?? 0,
        version: 1,
        availability: 'unreadable',
        activeWrite: false,
        diagnostics: readError,
      });
      diagnostics.push(`${file}: ${readError}`);
      return;
    }

    const size = meta?.size ?? 0;
    const mtimeMs = meta?.mtimeMs ?? 0;
    const activeWrite = nowMs - mtimeMs <= window;

    if (size === 0) {
      sessions.push({
        id: projectName,
        file,
        root,
        projectId: bucketDir,
        projectPath: bucketDir,
        name: null,
        createdAt: null,
        updatedAt: new Date(mtimeMs).toISOString(),
        sizeBytes: 0,
        version: 1,
        availability: 'empty',
        activeWrite,
        diagnostics: 'file is empty',
      });
      return;
    }

    const { header, error } = parseHeader(head);
    if (!header) {
      sessions.push({
        id: projectName,
        file,
        root,
        projectId: bucketDir,
        projectPath: bucketDir,
        name: null,
        createdAt: null,
        updatedAt: new Date(mtimeMs).toISOString(),
        sizeBytes: size,
        version: 1,
        availability: 'corrupt',
        activeWrite,
        diagnostics: error ?? 'unreadable header',
      });
      diagnostics.push(`${file}: ${error ?? 'unreadable header'}`);
      return;
    }

    const name = await readDisplayName(fs, file);
    sessions.push({
      id: header.id ?? projectName,
      file,
      root,
      projectId: header.cwd,
      projectPath: header.cwd,
      name,
      createdAt: header.timestamp,
      updatedAt: new Date(mtimeMs).toISOString(),
      sizeBytes: size,
      version: header.version,
      availability: 'ok',
      activeWrite,
      diagnostics: null,
    });
  };

  for (const root of roots) {
    let entries: DirEntry[];
    try {
      entries = await fs.readdir(root);
    } catch (err) {
      const msg = `root ${root}: ${err instanceof Error ? err.message : String(err)}`;
      diagnostics.push(msg);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const bdir = path.posix.join(root, entry.name);
        let files: DirEntry[];
        try {
          files = await fs.readdir(bdir);
        } catch (err) {
          diagnostics.push(`bucket ${bdir}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        for (const f of files) {
          if (f.isFile() && f.name.endsWith('.jsonl')) {
            await processFile(path.posix.join(bdir, f.name), root, entry.name);
          }
        }
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        await processFile(path.posix.join(root, entry.name), root, '(root)');
      }
    }
  }

  // Projects keyed by header cwd; corrupt-header files bucket by directory.
  const byProject = new Map<string, { sessions: SessionInfoT[] }>();
  for (const s of sessions) {
    const bucket = byProject.get(s.projectPath) ?? { sessions: [] };
    bucket.sessions.push(s);
    byProject.set(s.projectPath, bucket);
  }
  const projects: ProjectInfoT[] = [...byProject.entries()]
    .map(([projectPath, { sessions: ss }]) => {
      let last: number | null = null;
      for (const s of ss) {
        const t = Date.parse(s.updatedAt);
        if (Number.isFinite(t) && (last === null || t > last)) last = t;
      }
      return {
        id: projectPath,
        path: projectPath,
        sessionCount: ss.length,
        lastActivityAt: last === null ? null : new Date(last).toISOString(),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  return { projects, sessions, diagnostics };
}
