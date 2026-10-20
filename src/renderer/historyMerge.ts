/**
 * Pure accumulation of history pages (M1, review round 4 + P2#1).
 *
 * The `readSessionFile` cursor is strictly forward: page 1 holds the EARLIEST
 * entries and every continuation holds LATER ones. A continuation page is
 * therefore APPENDED after the current entries — prepending it would mix the
 * chronology of any session longer than one page.
 *
 * Parse diagnostics of EVERY loaded page are kept (append order, deduped by
 * line+error, bounded by MAX_READ_DIAGNOSTICS — earliest pages win on the
 * cut): dropping earlier pages' diagnostics after «Загрузить продолжение»
 * would hide real corrupt-line reports from the UI (P2#1, owner disposition).
 */
import { MAX_READ_DIAGNOSTICS, type ReadDiagnosticT, type ReadSessionResultT } from '../shared/m1Protocol';

function mergeDiagnostics(prev: ReadDiagnosticT[], next: ReadDiagnosticT[]): ReadDiagnosticT[] {
  const seen = new Set<string>();
  const out: ReadDiagnosticT[] = [];
  for (const diag of [...prev, ...next]) {
    if (out.length >= MAX_READ_DIAGNOSTICS) break; // earliest pages win on the cut
    const key = `${diag.line}\u0000${diag.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diag);
  }
  return out;
}

export function mergeHistoryPage(
  prev: ReadSessionResultT | null,
  next: ReadSessionResultT,
  since?: string,
): ReadSessionResultT {
  if (!prev || !since) return next;
  return {
    ...next,
    entries: [...prev.entries, ...next.entries],
    diagnostics: mergeDiagnostics(prev.diagnostics, next.diagnostics),
  };
}
