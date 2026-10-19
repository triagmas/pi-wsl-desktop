export interface WinProcess {
  pid: number;
  ppid: number;
  exe: string | null;
  cmd?: string | null;
}
export declare function ownedPids(table: WinProcess[], rootPid: number, exePath: string): number[];
export declare function markerPids(rows: WinProcess[], marker: string): number[];
export declare function cmdlineRoots(rows: WinProcess[], exePath: string, arg: string): number[];
