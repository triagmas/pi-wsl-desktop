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
import { MAX_READ_DIAGNOSTICS, MAX_READ_RESULT_BYTES, READ_ENTRY_OVERHEAD_BYTES } from '../shared/m1Protocol';
import type { ReadSessionResultT, SessionEntryT, SessionHeaderT } from '../shared/m1Protocol';
import type { FsLike } from './sessions';

export interface ReadSessionFileOptions {
  /** NARROWED by the M2 hardening (R1b): reads of a validated descriptor use
   * only stat+readRange; readHead/readTail stay path-based and are never part
   * of this reader — the type keeps a future refactor from silently
   * re-opening a pathname mid-read. */
  fs: Pick<FsLike, 'stat' | 'readRange'>;
  file: string;
  sinceEntryId?: string;
  /** UI21 F1-B R03: entries strictly BEFORE this cursor (backward paging). */
  beforeEntryId?: string;
  /** UI21 F1-B R03: page direction (default forward = earliest first). */
  direction?: 'forward' | 'backward';
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
const MAX_DIAGNOSTICS = MAX_READ_DIAGNOSTICS; // one bound, shared with the renderer's page merge (P2#1)

interface LightRow {
  id: string | null;
  parentId: string | null;
  seq: number;
  /** 1-based source line — positional fallback cursor for id-less rows. */
  lineNo: number;
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
    rows.push({ id, parentId, seq, lineNo });
    rawBySeq.push(entry);
    if (id) prevId = id;
  };

  try {
    while (offset < bytesToRead) {
      // Byte-faithful chunking: readRange returns raw bytes, so a multibyte
      // character straddling the boundary never corrupts the line or drifts
      // the offset (review round 3, #1).
      const chunkBuf = await fs.readRange(file, offset, Math.min(chunkBytes, bytesToRead - offset));
      if (chunkBuf.length === 0) break;
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
  let sinceLine = -1;
  if (opts.sinceEntryId !== undefined) {
    const lineCursor = /^L(\d+)$/.exec(opts.sinceEntryId);
    if (lineCursor) {
      // Positional fallback cursor (`L<lineNo>`) for pages whose rows carry no
      // ids — older history stays reachable instead of silently stalling
      // (review round 3, #3).
      sinceLine = Number(lineCursor[1]);
    } else {
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
  }

  const eligibleForward = pool.filter((r) => (sinceLine >= 0 ? r.lineNo > sinceLine : r.seq > startSeq));
  const backward = opts.direction === 'backward';

  // UI21 F1-B R03: обратный курсор — записи СТРОГО РАНЬШЕ указанной.
  let beforeSeq = Number.POSITIVE_INFINITY;
  let beforeLine = Number.POSITIVE_INFINITY;
  if (opts.beforeEntryId !== undefined) {
    const lineCursor = /^L(\d+)$/.exec(opts.beforeEntryId);
    if (lineCursor) {
      beforeLine = Number(lineCursor[1]);
    } else {
      const idx = rows.findIndex((r) => r.id === opts.beforeEntryId);
      if (idx === -1) {
        pushDiag(Math.max(lineNo, 1), `cursor not found: ${opts.beforeEntryId}`);
        return {
          header,
          entries: [],
          leafId,
          nextCursor: null,
          prevCursor: null,
          atStart: false,
          truncated,
          partialTrailing,
          diagnostics,
          availability,
        };
      }
      beforeSeq = rows[idx].seq;
    }
  }
  const eligible = backward
    ? pool.filter((r) => r.seq < beforeSeq && r.lineNo < beforeLine)
    : eligibleForward;

  // UI21 F1-B R03 (P1): пагинация ОБРАТНО и БЮДЖЕТ БАЙТ.
  //
  // Причина: лимит страницы считался в записях, а запись тянет за собой raw
  // (вывод инструмента, длинный ответ). 100 записей ≈ 1.1 МиБ > MAX_FRAME_BYTES,
  // кодировщик кадра бросал исключение и bridge выходил с кодом 1 — длинную
  // сессию нельзя было открыть вообще.
  // Оценка размера записи на проводе (сознательно консервативная).
  //
  // `raw` — исходная строка JSONL целиком, поэтому её JSON уже включает
  // id/parentId/timestamp. Обёртка `SessionEntryT` ПОВТОРЯЕТ эти три поля, то
  // есть добавляет их длину второй раз: считаем её явно (`dupe`) и прибавляем
  // READ_ENTRY_OVERHEAD_BYTES на фиксированные ключи, кавычки, запятые и
  // экранирование. Итог: сериализованная страница не больше ΣsizeOf, а бюджет
  // 768 КиБ оставляет ≥256 КиБ запаса до MAX_FRAME_BYTES=1 МиБ на обвязку
  // ответа (header/leafId/prevCursor/diagnostics).
  const sizeOf = (row: LightRow): number => {
    const raw = rawBySeq[row.seq];
    if (!raw) return 0;
    const dupe = (raw.id?.length ?? 0) + (raw.parentId?.length ?? 0) + (raw.timestamp?.length ?? 0);
    return Buffer.byteLength(JSON.stringify(raw), 'utf8') + READ_ENTRY_OVERHEAD_BYTES + dupe;
  };

  const picked: LightRow[] = [];
  const skipped: LightRow[] = [];
  let used = 0;
  const order = backward ? [...eligible].reverse() : eligible;
  // Заполняем страницу от курсора (вперёд — самые старые eligible, обратно —
  // самые новые), пока хватает бюджета. Запись, которая одна не влезает в
  // бюджет, пропускается с диагностикой: иначе страница встала бы навсегда.
  for (const row of order) {
    if (picked.length >= limit) break;
    const size = sizeOf(row);
    if (used + size > MAX_READ_RESULT_BYTES) {
      if (picked.length === 0) {
        skipped.push(row);
        pushDiag(row.lineNo, `entry exceeds MAX_READ_RESULT_BYTES=${MAX_READ_RESULT_BYTES}`);
        continue;
      }
      break;
    }
    used += size;
    picked.push(row);
  }
  if (backward) picked.reverse(); // хронологический порядок внутри страницы

  const page = picked;
  const consumed = picked.length + skipped.length;
  const pageTruncated = backward ? false : eligible.length > consumed;
  const entries: SessionEntryT[] = [];
  for (const r of page) {
    const raw = rawBySeq[r.seq];
    if (raw) entries.push(raw);
  }
  const lastRow = page.length > 0 ? page[page.length - 1] : null;
  const firstRow = page.length > 0 ? page[0] : null;
  // Id cursor for normal rows; positional `L<lineNo>` fallback for id-less
  // rows so "load earlier" never dead-ends (review round 3, #3). Cursor is
  // offered whenever a page was returned — same parity as entry-id cursors.
  const lastId = lastRow ? (lastRow.id ?? (lastRow.lineNo > 0 ? `L${lastRow.lineNo}` : null)) : null;
  // Если все записи страницы не влезли в бюджет, курсор всё равно обязан
  // сдвинуться — на последнюю ПРОПУЩЕННУЮ запись, иначе вызывающий застрянет.
  const forwardFallback = skipped.length > 0 ? skipped[skipped.length - 1] : null;
  const prevCursor =
    firstRow !== null
      ? (firstRow.id ?? (firstRow.lineNo > 0 ? `L${firstRow.lineNo}` : null))
      : backward && skipped.length > 0
        ? // Все записи окна пропущены по бюджету: уходим ЗА самое старое из них,
          // иначе следующая страница перечитает тот же батч (работа впустую).
          (skipped[skipped.length - 1].id ?? `L${skipped[skipped.length - 1].lineNo}`)
        : null;
  // atStart: у окна нет более старых записей → «загрузить предыдущие» скрыта.
  const atStart = backward
    ? page.length > 0
      ? !eligible.some((r) => r.seq < (page[0] as LightRow).seq)
      : eligible.length === 0
    : false;

  return {
    header,
    entries,
    leafId,
    nextCursor: lastId ?? (forwardFallback ? (forwardFallback.id ?? `L${forwardFallback.lineNo}`) : null),
    prevCursor: prevCursor ?? null,
    atStart,
    truncated: truncated || pageTruncated,
    partialTrailing,
    diagnostics,
    availability,
  };
}
