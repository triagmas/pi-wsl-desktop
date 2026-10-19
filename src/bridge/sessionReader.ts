/**
 * Read-only Pi session reader (M1, SPEC §3.2/§4.1, Issue #5 gates 2–3).
 *
 * NEVER writes: the only fs operation here is stat + bounded sequential
 * reads. Legacy v1/v2 files must NEVER be routed through Pi's
 * migration-capable SessionManager for preview — this parser tolerates them
 * natively (v1: linear chain reconstruction; v2/v3: id/parentId tree).
 *
 * Robustness rules:
 * - strict LF framing on BYTES (no readline, no Unicode-separator splits);
 * - bounded: chunked reads, per-line byte cap, total-byte cap, entry cap —
 *   fail with diagnostics instead of OOM;
 * - corrupt lines are skipped with numbered diagnostics (never fatal);
 * - a partial trailing line means a writer is mid-append: reported, never
 *   misparsed;
 * - unknown future entry types survive verbatim as opaque raw records;
 * - pagination: `sinceEntryId` (strictly-after cursor) + bounded `limit`;
 * - `branch: 'active'` walks leaf→root (parentId chain, cycle-guarded).
 */
import type { ReadSessionResultT, SessionEntryT, SessionHeaderT } from '../shared/m1Protocol';
import type { FsLike } from './sessions';

export interface ReadSessionFileOptions {
  fs: FsLike;
  file: string;
  sinceEntryId?: string;
  /** Bounded page size (contract caps it at 500). */
  limit?: number;
  branch?: 'active' | 'all';
  chunkBytes?: number;
  maxLineBytes?: number;
  maxBytesTotal?: number;
  maxEntries?: number;
}

const DEFAULTS = {
  limit: 200,
  chunkBytes: 64 * 1024,
  maxLineBytes: 8 * 1024 * 1024,
  maxBytesTotal: 32 * 1024 * 1024,
  maxEntries: 5_000,
};
const MAX_DIAGNOSTICS = 100;

interface LightRow {
  id: string | null;
  parentId: string | null;
  seq: number;
}

export function computeActiveLeaf(rows: ReadonlyArray<{ id: string | null; parentId: string | null }>): string | null {
  const parents = new Set<string>();
  for (const r of rows) if (r.parentId) parents.add(r.parentId);
  let leaf: string | null = null;
  for (const r of rows) {
    if (r.id && !parents.has(r.id)) leaf = r.id; // append-order last wins
  }
  return leaf;
}

export function activeBranchPath(
  rows: ReadonlyArray<{ id: string | null; parentId: string | null }>,
  leafId: string | null,
): string[] {
  if (!leafId) return [];
  const byId = new Map<string, { id: string | null; parentId: string | null }>();
  for (const r of rows) if (r.id && !byId.has(r.id)) byId.set(r.id, r);
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = leafId;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    const row: { id: string | null; parentId: string | null } | undefined = byId.get(cur);
    if (!row) break; // orphan/ghost parent: stop safely at the known chain
    cur = row.parentId;
  }
  return path.reverse();
}

function emptyResult(availability: ReadSessionResultT['availability']): ReadSessionResultT {
  return {
    header: null,
    entries: [],
    leafId: null,
    nextCursor: null,
    truncated: false,
    partialTrailing: false,
    diagnostics: [],
    availability,
  };
}

export async function readSessionFile(opts: ReadSessionFileOptions): Promise<ReadSessionResultT> {
  const { fs, file } = opts;
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULTS.limit, 500));
  const chunkBytes = opts.chunkBytes ?? DEFAULTS.chunkBytes;
  const maxLineBytes = opts.maxLineBytes ?? DEFAULTS.maxLineBytes;
  const maxBytesTotal = opts.maxBytesTotal ?? DEFAULTS.maxBytesTotal;
  const maxEntries = opts.maxEntries ?? DEFAULTS.maxEntries;

  let meta: { size: number; mtimeMs: number };
  try {
    meta = await fs.stat(file);
  } catch {
    return emptyResult('unreadable');
  }
  if (meta.size === 0) return emptyResult('empty');

  const diagnostics: ReadSessionResultT['diagnostics'] = [];
  const pushDiag = (line: number, error: string): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ line, error });
  };

  let availability: ReadSessionResultT['availability'] = 'ok';
  let header: SessionHeaderT | null = null;
  let truncated = meta.size > maxBytesTotal;
  const bytesToRead = Math.min(meta.size, maxBytesTotal);

  const rows: LightRow[] = [];
  const rawBySeq: Array<SessionEntryT | null> = [];
  let capHit = false;
  let partialTrailing = false;

  let pending = Buffer.alloc(0);
  let offset = 0;
  let lineNo = 0;
  let oversizeActive = false;
  let oversizeLine = 0;
  let prevId: string | null = null;
  let version = 3;

  const handleLine = (lineBuf: Buffer): void => {
    lineNo += 1;
    if (lineBuf.length > maxLineBytes) {
      // Whole-line cap (complete line within one chunk): drop with diagnostic.
      pushDiag(lineNo, `line exceeds maxLineBytes=${maxLineBytes}`);
      return;
    }
    let text = lineBuf.toString('utf8');
    if (text.endsWith('\r')) text = text.slice(0, -1);

    if (oversizeActive) {
      // The line that triggered the cap just terminated here.
      oversizeActive = false;
      pushDiag(oversizeLine, `line exceeds maxLineBytes=${maxLineBytes}`);
      return;
    }
    if (text === '') return; // blank separator — tolerated, not diagnostic

    if (lineNo === 1) {
      try {
        const raw = JSON.parse(text) as Record<string, unknown>;
        const ok =
          raw?.type === 'session' &&
          (raw.version === 1 || raw.version === 2 || raw.version === 3) &&
          typeof raw.id === 'string' &&
          typeof raw.timestamp === 'string' &&
          typeof raw.cwd === 'string';
        if (!ok) throw new Error('invalid session header shape');
        version = raw.version as number;
        header = {
          type: 'session',
          version: raw.version as 1 | 2 | 3,
          id: raw.id as string,
          timestamp: raw.timestamp as string,
          cwd: raw.cwd as string,
          ...(typeof raw.parentSession === 'string' ? { parentSession: raw.parentSession } : {}),
        };
      } catch (err) {
        availability = 'corrupt';
        pushDiag(1, `invalid session header: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (rows.length >= maxEntries) {
      capHit = true;
      return;
    }

    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      pushDiag(lineNo, `invalid json: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      pushDiag(lineNo, 'entry is not an object with a type');
      return;
    }
    const rec = obj as Record<string, unknown>;
    if (typeof rec.type !== 'string' || rec.type === '') {
      pushDiag(lineNo, 'missing entry type');
      return;
    }

    const id = typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : null;
    // v1 legacy: no parentId fields — reconstruct the linear chain.
    const parentId =
      typeof rec.parentId === 'string' && rec.parentId.length > 0
        ? rec.parentId
        : rec.parentId === null
          ? null
          : version === 1
            ? prevId
            : null;
    const entry: SessionEntryT = {
      type: rec.type,
      id,
      parentId,
      timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : null,
      raw: rec,
    };
    const seq = rows.length;
    rows.push({ id, parentId, seq });
    rawBySeq.push(entry);
    if (id) prevId = id;
  };

  try {
    while (offset < bytesToRead) {
      const chunk = await fs.readRange(file, offset, Math.min(chunkBytes, bytesToRead - offset));
      if (chunk === '') break;
      const chunkBuf = Buffer.from(chunk, 'utf8');
      offset += chunkBuf.length;

      let cursor = 0;
      for (;;) {
        const nl = chunkBuf.indexOf(0x0a, cursor);
        if (nl === -1) break;
        const combined = pending.length > 0 ? Buffer.concat([pending, chunkBuf.subarray(cursor, nl)]) : chunkBuf.subarray(cursor, nl);
        pending = Buffer.alloc(0);
        handleLine(combined);
        cursor = nl + 1;
      }
      if (cursor < chunkBuf.length) {
        pending = Buffer.concat([pending, chunkBuf.subarray(cursor)]);
        if (pending.length > maxLineBytes && !oversizeActive) {
          oversizeActive = true;
          oversizeLine = lineNo + 1;
          pending = Buffer.alloc(0); // drop the oversize content immediately
        }
      }
      if (capHit) {
        truncated = true;
        break;
      }
    }
  } catch (err) {
    pushDiag(Math.max(lineNo, 1), `read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...emptyResult('unreadable'), diagnostics };
  }

  if (pending.length > 0) partialTrailing = true;
  if (oversizeActive) {
    pushDiag(oversizeLine, `line exceeds maxLineBytes=${maxLineBytes}`);
    oversizeActive = false;
  }
  if (capHit) pushDiag(Math.max(lineNo, 1), `entry cap reached (maxEntries=${maxEntries})`);

  const leafId = computeActiveLeaf(rows);
  let pool: LightRow[] = rows;
  if (opts.branch === 'active' && leafId) {
    const active = new Set(activeBranchPath(rows, leafId));
    pool = rows.filter((r) => r.id !== null && active.has(r.id));
  }

  let startSeq = -1;
  if (opts.sinceEntryId !== undefined) {
    const idx = rows.findIndex((r) => r.id === opts.sinceEntryId);
    if (idx === -1) {
      pushDiag(Math.max(lineNo, 1), `cursor not found: ${opts.sinceEntryId}`);
      return {
        header,
        entries: [],
        leafId,
        nextCursor: null,
        truncated,
        partialTrailing,
        diagnostics,
        availability,
      };
    }
    startSeq = rows[idx].seq;
  }

  const eligible = pool.filter((r) => r.seq > startSeq);
  const page = eligible.slice(0, limit);
  const pageTruncated = eligible.length > limit;
  const entries: SessionEntryT[] = [];
  for (const r of page) {
    const raw = rawBySeq[r.seq];
    if (raw) entries.push(raw);
  }
  const lastId = page.length > 0 ? page[page.length - 1].id : null;

  return {
    header,
    entries,
    leafId,
    nextCursor: lastId,
    truncated: truncated || pageTruncated,
    partialTrailing,
    diagnostics,
    availability,
  };
}
