export declare const DEFAULT_EXPECT_TITLE: string;
export interface WinInfo {
  pid: number;
  visible: boolean;
  title: string;
}
export declare function parseWindows(stdout: string): WinInfo[];
export declare function ownedWindows(windows: WinInfo[], ownedPids: number[]): WinInfo[];
export declare function ownedVisibleWindows(windows: WinInfo[], ownedPids: number[]): WinInfo[];
export declare function newPids(before: number[], after: number[]): number[];
export declare function windowScript(pids: number[]): string;
export interface SmokeArgs {
  exe: string | null;
  out: string;
  timeoutMs: number;
  expectTitle: string;
}
export declare function parseSmokeArgs(argv: string[], cwd?: string): SmokeArgs;
export interface SmokeResult {
  exe: string;
  userData: string;
  startedAt: string;
  expectedTitle: string;
  baselinePids: number[];
  windows: WinInfo[];
  visible: boolean;
  ownedPids: number[];
  elapsedMs: number | null;
  matchedTitle?: boolean;
  leftoverPids?: number[];
}
export declare function runSmoke(
  args: SmokeArgs,
  deps?: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    listPids?: () => number[];
    spawn?: typeof import('node:child_process').spawn;
    enumerate?: (pids: number[]) => string;
  },
): Promise<SmokeResult>;
