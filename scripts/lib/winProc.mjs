/**
 * Windows smoke process-ownership predicate (review P1 #2).
 *
 * `ownedPids` returns only PIDs that are PROVABLY ours:
 *   - the spawned root itself — only if its executable path still matches
 *     (guards against PID reuse), and
 *   - descendants of that root running our exact executable (Electron
 *     helper processes).
 *
 * Everything else — same image name but unrelated tree, different path,
 * broken parent chain — is excluded. When in doubt, do not kill.
 *
 * Pure and platform-independent so it is unit-testable anywhere; the smoke
 * script feeds it a Win32_Process table.
 */

/**
 * @typedef {object} WinProcess
 * @property {number} pid
 * @property {number} ppid
 * @property {string | null} exe ExecutablePath from Win32_Process (null when unreadable).
 */

/**
 * @param {WinProcess[]} table process table (any order)
 * @param {number} rootPid PID returned by our own spawn()
 * @param {string} exePath path of the electron.exe we launched
 * @returns {number[]} PIDs we are allowed to terminate (ascending)
 */
export function ownedPids(table, rootPid, exePath) {
  const norm = (p) => (p ?? '').toLowerCase().replace(/\//g, '\\');
  const want = norm(exePath);
  if (!want) return [];

  const byPid = new Map(table.map((row) => [row.pid, row]));
  const root = byPid.get(rootPid);
  // Root must be alive AND still map to our executable — a recycled PID or a
  // missing row means we cannot prove ownership of anything: kill nothing.
  if (!root || norm(root.exe) !== want) return [];

  /** @param {number} pid */
  const descendsFromRoot = (pid) => {
    let cur = byPid.get(pid);
    let guard = 0;
    while (cur && guard < table.length + 1) {
      if (cur.pid === rootPid) return true;
      cur = byPid.get(cur.ppid);
      guard += 1;
    }
    return false; // orphaned row or parent cycle → not provably ours
  };

  const owned = [];
  for (const row of table) {
    if (norm(row.exe) !== want) continue; // exact executable only, no name matching
    if (row.pid === rootPid || descendsFromRoot(row.pid)) owned.push(row.pid);
  }
  return owned.sort((a, b) => a - b);
}

/**
 * Resolve processes by OUR unique command-line marker (decoy liveness).
 * The marker is generated per run, so a match is provable ownership.
 *
 * @param {{pid: number, cmd?: string | null}[]} rows
 * @param {string} marker
 * @returns {number[]}
 */
export function markerPids(rows, marker) {
  if (!marker) return [];
  return rows
    .filter((row) => (row.cmd ?? '').includes(marker))
    .map((row) => row.pid)
    .sort((a, b) => a - b);
}

/**
 * Candidates for the app root by EXACT executable + launch argument — used
 * only as a fallback when the app could not self-report its Windows PID.
 * The caller must additionally require exactly one match (ambiguity → doubt
 * → kill nothing).
 *
 * @param {{pid: number, exe: string | null, cmd?: string | null}[]} rows
 * @param {string} exePath Windows path of our electron.exe
 * @param {string} arg the exact launch argument we passed
 * @returns {number[]}
 */
/**
 * Argument portion of a command line: everything after the executable token
 * (first quoted segment, or first word in short-name form). Matching the
 * argument ONLY (not the whole line) prevents the exe path itself from
 * satisfying an argument needle that is a substring of it.
 *
 * @param {string | null} cmd
 * @returns {string}
 */
function argTail(cmd) {
  const c = cmd ?? '';
  if (!c) return '';
  if (c.startsWith('"')) {
    const end = c.indexOf('"', 1);
    return end === -1 ? '' : c.slice(end + 1);
  }
  const sp = c.indexOf(' ');
  return sp === -1 ? '' : c.slice(sp + 1);
}

/**
 * Quote-aware tokenizer for the argument tail: tokens are separated by
 * whitespace OUTSIDE double quotes; a doubled `""` inside a quoted token is
 * a literal quote (MSVC-style embedded quote).
 *
 * @param {string} tail
 * @returns {string[]}
 */
function tokenizeArgs(tail) {
  const tokens = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < tail.length; i += 1) {
    const ch = tail[i];
    if (ch === '"') {
      if (inQuotes && tail[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if ((ch === ' ' || ch === '\t') && !inQuotes) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function cmdlineRoots(rows, exePath, arg) {
  const norm = (p) => (p ?? '').toLowerCase().replace(/\//g, '\\');
  const want = norm(exePath);
  if (!want || !arg) return [];
  const needle = arg.toLowerCase();
  // EXACT full-argument equality (review R2 P2): `F:\repo` must never match
  // the argument `F:\repo-backup`, and quote-wrapped arguments must match
  // only as a whole token.
  return rows
    .filter(
      (row) =>
        norm(row.exe) === want &&
        tokenizeArgs(argTail(row.cmd)).some((tok) => tok.toLowerCase() === needle),
    )
    .map((row) => row.pid)
    .sort((a, b) => a - b);
}

/**
 * Fail-closed cleanup planner (review round 2, P1): decides what MAY be
 * killed — but kills nothing itself, so unit tests can pin the safety rules:
 *
 * - identity table unavailable → `inconclusive` (NEVER taskkill an
 *   unverified pid — a reused PID could belong to a foreign process tree),
 * - self-reported pid must exist in the table WITH our exact executable
 *   (mismatch → PID reuse → `inconclusive`; absent → `noop`, app is gone),
 * - without a self-reported pid exactly ONE unambiguous exact-cmdline root
 *   is required; 0 or 2+ → `inconclusive`.
 *
 * @param {{table: WinProcess[] | null, reportPid: number | null, exePath: string, arg: string}} input
 * @returns {{action: 'kill' | 'inconclusive' | 'noop', pids: number[], reason: string, source?: string}}
 */
export function planCleanup({ table, reportPid, exePath, arg }) {
  if (!table) {
    return {
      action: 'inconclusive',
      pids: [],
      reason: 'identity table unavailable (processTable null) — fail-closed, 0 taskkill',
    };
  }
  const norm = (p) => (p ?? '').toLowerCase().replace(/\//g, '\\');
  if (reportPid) {
    const root = table.find((r) => r.pid === reportPid);
    if (!root) {
      return { action: 'noop', pids: [], reason: 'self-reported pid absent from electron table (app already exited)' };
    }
    if (norm(root.exe) !== norm(exePath)) {
      return {
        action: 'inconclusive',
        pids: [],
        reason: `PID reuse: pid ${reportPid} exe mismatch (root identity unprovable) — fail-closed, 0 taskkill`,
      };
    }
    const pids = ownedPids(table, reportPid, exePath);
    if (pids.length === 0) {
      return {
        action: 'inconclusive',
        pids: [],
        reason: 'verified root produced no owned tree — fail-closed, 0 taskkill',
      };
    }
    return { action: 'kill', pids, reason: 'path+tree verified', source: 'self-reported pid' };
  }
  const cands = cmdlineRoots(table, exePath, arg);
  if (cands.length === 1) {
    const pids = ownedPids(table, cands[0], exePath);
    if (pids.length === 0) {
      return {
        action: 'inconclusive',
        pids: [],
        reason: 'exact cmdline root produced no owned tree — fail-closed, 0 taskkill',
      };
    }
    return { action: 'kill', pids, reason: 'path+tree verified', source: 'exact cmdline match' };
  }
  if (cands.length > 1) {
    return {
      action: 'inconclusive',
      pids: [],
      reason: `ambiguous cmdline match (${cands.length} candidates) — fail-closed, 0 taskkill`,
    };
  }
  return {
    action: 'inconclusive',
    pids: [],
    reason: 'no identity source (no self-reported pid, no exact cmdline match) — fail-closed, 0 taskkill',
  };
}
