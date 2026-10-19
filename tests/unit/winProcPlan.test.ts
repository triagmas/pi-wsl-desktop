/**
 * fail-closed ownership planner — review round 2 P1 gate:
 * when processTable() is unavailable OR identity cannot be proven, the smoke
 * must plan ZERO taskkills (diagnostic FAIL, never kill an unverified pid).
 */
import { describe, expect, it } from 'vitest';
import { planCleanup } from '../../scripts/lib/winProc.mjs';

const EXE = 'F:\\_hermes\\CODE\\pi-wsl-desktop\\artifacts\\win-electron\\electron.exe';
const ARG = 'F:\\_hermes\\CODE\\pi-wsl-desktop';

describe('planCleanup (fail-closed ownership planner, review R2 P1)', () => {
  it('processTable() null → inconclusive with ZERO kill pids (never taskkill an unverified pid)', () => {
    const plan = planCleanup({ table: null, reportPid: 1234, exePath: EXE, arg: ARG });
    expect(plan.action).toBe('inconclusive');
    expect(plan.pids).toEqual([]);
    expect(plan.reason).toMatch(/table/i);
  });

  it('PID reuse: self-reported pid now maps to a different executable → inconclusive, no kill', () => {
    const table = [{ pid: 1234, ppid: 4, exe: 'C:\\Windows\\System32\\notepad.exe', cmd: 'notepad.exe' }];
    const plan = planCleanup({ table, reportPid: 1234, exePath: EXE, arg: ARG });
    expect(plan.action).toBe('inconclusive');
    expect(plan.pids).toEqual([]);
    expect(plan.reason).toMatch(/reuse|mismatch/i);
  });

  it('happy path: self-reported pid with our exe → kill exactly the verified tree', () => {
    const table = [
      { pid: 1234, ppid: 4, exe: EXE, cmd: `electron.exe ${ARG}` },
      { pid: 1235, ppid: 1234, exe: EXE, cmd: 'electron.exe --type=renderer' },
      { pid: 900, ppid: 4, exe: EXE, cmd: 'electron.exe F:\\other' },
    ];
    const plan = planCleanup({ table, reportPid: 1234, exePath: EXE, arg: ARG });
    expect(plan.action).toBe('kill');
    expect(plan.pids).toEqual([1234, 1235]);
    expect(plan.pids).not.toContain(900);
  });

  it('no self-reported pid: single exact cmdline match → kill that tree', () => {
    const table = [
      { pid: 200, ppid: 4, exe: EXE, cmd: `electron.exe ${ARG}` },
      { pid: 201, ppid: 200, exe: EXE, cmd: 'electron.exe --type=renderer' },
    ];
    const plan = planCleanup({ table, reportPid: null, exePath: EXE, arg: ARG });
    expect(plan.action).toBe('kill');
    expect(plan.pids).toEqual([200, 201]);
  });

  it('no self-reported pid + prefix/ambiguity → only exact arg counts; otherwise no kill', () => {
    const ambiguous = [
      { pid: 300, ppid: 4, exe: EXE, cmd: `electron.exe ${ARG}` },
      { pid: 301, ppid: 4, exe: EXE, cmd: `electron.exe ${ARG}` },
    ];
    const planAmb = planCleanup({ table: ambiguous, reportPid: null, exePath: EXE, arg: ARG });
    expect(planAmb.action).toBe('inconclusive');
    expect(planAmb.pids).toEqual([]);

    const prefixOnly = [
      { pid: 300, ppid: 4, exe: EXE, cmd: 'electron.exe F:\\_hermes\\CODE\\pi-wsl-desktop-backup' },
    ];
    const planPrefix = planCleanup({ table: prefixOnly, reportPid: null, exePath: EXE, arg: ARG });
    expect(planPrefix.action).toBe('inconclusive');
    expect(planPrefix.pids).toEqual([]);
  });
});
