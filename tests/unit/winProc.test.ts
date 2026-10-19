/**
 * RED gate for the Windows smoke ownership predicate (review P1 #2).
 *
 * `ownedPids` must only ever return PIDs that are provably ours:
 *   - the spawned root itself (only if its executable path still matches —
 *     guards against PID reuse), and
 *   - descendants of that root running the same executable (Electron helper
 *     processes).
 *
 * Anything else — same image name, different path, unrelated tree, broken
 * parent chain — must be excluded ("when in doubt, do not kill").
 *
 * The module lives at scripts/lib/winProc.mjs (+ winProc.d.mts typings) and
 * is consumed by scripts/windows-smoke.mjs for cleanup decisions.
 */
import { describe, expect, it } from 'vitest';
import { cmdlineRoots, markerPids, ownedPids } from '../../scripts/lib/winProc.mjs';

const EXE = 'F:\\_hermes\\CODE\\pi-wsl-desktop\\artifacts\\win-electron\\electron.exe';

interface Row {
  pid: number;
  ppid: number;
  exe: string;
}

describe('ownedPids (Windows smoke process ownership)', () => {
  it('includes the root and its descendant helpers with our exact executable', () => {
    const table: Row[] = [
      { pid: 100, ppid: 4, exe: EXE }, // root we spawned
      { pid: 101, ppid: 100, exe: EXE }, // electron helper
      { pid: 102, ppid: 101, exe: EXE }, // deeper helper
    ];
    expect(ownedPids(table, 100, EXE)).toEqual([100, 101, 102]);
  });

  it('NEVER selects a foreign electron.exe that is not in our tree', () => {
    const table: Row[] = [
      { pid: 100, ppid: 4, exe: EXE },
      { pid: 101, ppid: 100, exe: EXE },
      { pid: 900, ppid: 4, exe: EXE }, // user opened another Electron mid-test
      { pid: 901, ppid: 900, exe: EXE }, // …and its helper
    ];
    const owned = ownedPids(table, 100, EXE);
    expect(owned).toEqual([100, 101]);
    expect(owned).not.toContain(900);
    expect(owned).not.toContain(901);
  });

  it('excludes same-name processes whose executable path differs from ours', () => {
    const table: Row[] = [
      { pid: 100, ppid: 4, exe: EXE },
      { pid: 500, ppid: 100, exe: 'C:\\Users\\someone\\AppData\\Local\\other\\electron.exe' },
    ];
    expect(ownedPids(table, 100, EXE)).toEqual([100]);
  });

  it('refuses to kill anything when the root PID no longer maps to our executable (PID reuse)', () => {
    const table: Row[] = [
      { pid: 100, ppid: 4, exe: 'C:\\Windows\\System32\\something-else.exe' },
      { pid: 101, ppid: 100, exe: EXE },
    ];
    expect(ownedPids(table, 100, EXE)).toEqual([]);
  });

  it('handles an empty table and a root that is already gone', () => {
    expect(ownedPids([], 100, EXE)).toEqual([]);
  });

  it('markerPids resolves our unique decoy by its command-line marker (never by name)', () => {
    const rows = [
      { pid: 10, ppid: 4, exe: EXE, cmd: 'electron.exe F:\\repo' },
      { pid: 20, ppid: 4, exe: EXE, cmd: `electron.exe -e "var m='piwsd-smoke-decoy-abc'; setInterval(...)"` },
      { pid: 21, ppid: 4, exe: EXE, cmd: 'electron.exe F:\\other\\app' },
    ];
    expect(markerPids(rows, 'piwsd-smoke-decoy-abc')).toEqual([20]);
    expect(markerPids(rows, 'piwsd-smoke-decoy-NOPE')).toEqual([]);
    expect(markerPids(rows, '')).toEqual([]);
  });

  it('cmdlineRoots finds processes launched with OUR exact executable and argument, and nothing else', () => {
    const rows = [
      { pid: 10, ppid: 4, exe: EXE, cmd: `"${EXE}" F:\\_hermes\\CODE\\pi-wsl-desktop` },
      { pid: 11, ppid: 4, exe: EXE, cmd: 'electron.exe -e decoy-code' },
      { pid: 12, ppid: 4, exe: 'C:\\other\\electron.exe', cmd: `"C:\\other\\electron.exe" F:\\_hermes\\CODE\\pi-wsl-desktop` },
      { pid: 13, ppid: 4, exe: EXE, cmd: `"${EXE}" F:\\somewhere-else` },
    ];
    expect(cmdlineRoots(rows, EXE, 'F:\\_hermes\\CODE\\pi-wsl-desktop')).toEqual([10]);
    expect(cmdlineRoots(rows, EXE, 'F:\\no-such-arg')).toEqual([]);
    // short-name form as reported by Win32_Process for some rows:
    const short = [{ pid: 30, ppid: 4, exe: EXE, cmd: `electron.exe F:\\_hermes\\CODE\\pi-wsl-desktop` }];
    expect(cmdlineRoots(short, EXE, 'F:\\_hermes\\CODE\\pi-wsl-desktop')).toEqual([30]);
  });

  it('cmdlineRoots requires the FULL separate argument — prefix of an arg never matches', () => {
    const rows = [
      { pid: 40, ppid: 4, exe: EXE, cmd: `"${EXE}" F:\\repo-backup` },
      { pid: 41, ppid: 4, exe: EXE, cmd: `"${EXE}" F:\\repo` },
    ];
    expect(cmdlineRoots(rows, EXE, 'F:\\repo')).toEqual([41]); // NOT [40,41]
    expect(cmdlineRoots(rows, EXE, 'F:\\repo-extra')).toEqual([]);
  });

  it('cmdlineRoots unquotes the argument token (spaces) without partial matches', () => {
    const rows = [
      { pid: 50, ppid: 4, exe: EXE, cmd: `"${EXE}" "F:\\my app\\repo"` },
      { pid: 51, ppid: 4, exe: EXE, cmd: `"${EXE}" F:\\plain` },
    ];
    expect(cmdlineRoots(rows, EXE, 'F:\\my app\\repo')).toEqual([50]);
    expect(cmdlineRoots(rows, EXE, 'F:\\my app')).toEqual([]);
    expect(cmdlineRoots(rows, EXE, 'F:\\plain')).toEqual([51]);
  });

  it('cmdlineRoots with an embedded double quote (nested quoting) still matches exactly', () => {
    const rows = [
      { pid: 60, ppid: 4, exe: EXE, cmd: `"${EXE}" "F:\\say ""hi""\\repo"` },
    ];
    expect(cmdlineRoots(rows, EXE, 'F:\\say "hi"\\repo')).toEqual([60]);
    expect(cmdlineRoots(rows, EXE, 'F:\\say')).toEqual([]);
  });
});
