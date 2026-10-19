/**
 * `searchSessions` (M1, SPEC §4.1): metadata search by default, content
 * search only behind the EXPLICIT `includeContent` flag (privacy: browsing a
 * project index must not read conversation bodies), bounded per file and
 * globally.
 */
import type { SearchResultT } from '../shared/m1Protocol';
import type { FsLike, SessionIndex } from './sessions';

export interface SearchInput {
  fs: FsLike;
  index: SessionIndex;
  query: string;
  projectId?: string;
  includeContent?: boolean;
  /** Global match cap (default 100); reaching it sets `truncated`. */
  maxMatches?: number;
  /** Bytes read per session file in content mode (default 512 KiB). */
  contentBytesPerFile?: number;
}

const DEFAULTS = { maxMatches: 100, contentBytesPerFile: 512 * 1024 };

function snippetAround(line: string, idx: number, qLen: number): string {
  const start = Math.max(0, idx - 24);
  const end = Math.min(line.length, idx + qLen + 36);
  return (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
}

export async function searchSessions(input: SearchInput): Promise<SearchResultT> {
  const { fs, index } = input;
  const q = input.query.toLowerCase();
  const max = input.maxMatches ?? DEFAULTS.maxMatches;
  const contentCap = input.contentBytesPerFile ?? DEFAULTS.contentBytesPerFile;
  const matches: SearchResultT['matches'] = [];
  let truncated = false;

  const add = (m: SearchResultT['matches'][number]): boolean => {
    if (matches.length >= max) {
      truncated = true;
      return false;
    }
    matches.push(m);
    return true;
  };

  outer: for (const s of index.sessions) {
    if (input.projectId !== undefined && s.projectId !== input.projectId) continue;

    if (s.name && s.name.toLowerCase().includes(q)) {
      if (!add({ sessionId: s.id, file: s.file, projectId: s.projectId, field: 'name', line: null, snippet: s.name })) break;
    }
    if (s.projectPath.toLowerCase().includes(q)) {
      if (!add({ sessionId: s.id, file: s.file, projectId: s.projectId, field: 'cwd', line: null, snippet: s.projectPath })) break;
    }
    if (s.file.toLowerCase().includes(q)) {
      if (!add({ sessionId: s.id, file: s.file, projectId: s.projectId, field: 'path', line: null, snippet: s.file })) break;
    }

    if (!input.includeContent || s.availability !== 'ok') continue;

    let body: string;
    try {
      // Byte-faithful accumulation (review round 3, #1): decoding per chunk
      // would corrupt multibyte characters straddling the 64-KiB boundary and
      // drift the offset past real bytes.
      const parts: Buffer[] = [];
      let offset = 0;
      while (offset < contentCap) {
        const part = await fs.readRange(s.file, offset, Math.min(64 * 1024, contentCap - offset));
        if (part.length === 0) break;
        parts.push(part);
        offset += part.length;
      }
      body = Buffer.concat(parts).toString('utf8');
    } catch {
      continue; // unreadable bodies are a per-file miss, not a crash
    }
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const idx = lines[i].toLowerCase().indexOf(q);
      if (idx === -1) continue;
      const ok = add({
        sessionId: s.id,
        file: s.file,
        projectId: s.projectId,
        field: 'content',
        line: i + 1,
        snippet: snippetAround(lines[i], idx, q.length),
      });
      if (!ok) break outer;
    }
  }

  return { matches, truncated };
}
