export interface WinProcess {
  pid: number;
  ppid: number;
  exe: string | null;
  cmd?: string | null;
}
export declare function ownedPids(table: WinProcess[], rootPid: number, exePath: string): number[];
export declare function markerPids(rows: WinProcess[], marker: string): number[];
export declare function cmdlineRoots(rows: WinProcess[], exePath: string, arg: string): number[];
export interface CleanupPlan {
  action: 'kill' | 'inconclusive' | 'noop';
  pids: number[];
  reason: string;
  source?: string;
}
export declare function planCleanup(input: {
  table: WinProcess[] | null;
  reportPid: number | null;
  exePath: string;
  arg: string;
}): CleanupPlan;
