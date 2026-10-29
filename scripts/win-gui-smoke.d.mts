export declare const DEFAULT_EXPECT_TITLE: string;
export declare const USER_DATA_PREFIX: string;

export interface WinInfo {
  pid: number;
  visible: boolean;
  title: string;
}
export interface ProcInfo {
  pid: number;
  parentPid: number;
  exe: string;
  createdAt: string;
}
export interface OwnershipResult {
  ok: boolean;
  reason: string | null;
  owned: number[];
}
export interface CleanupPlan {
  kill: number[];
  inconclusive: boolean;
  note: string | null;
}
export interface SmokeVerdict {
  pass: boolean;
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  reasons: string[];
}
export interface SmokeReport {
  status: SmokeVerdict['status'];
  pass: boolean;
  reasons: string[];
  exe: string;
  userData?: string;
  startedAt: string;
  expectedTitle?: string;
  baselineProcessCount?: number;
  rootPid?: number | null;
  windows: WinInfo[];
  visible: boolean;
  titleMatched: boolean;
  ownedPids: number[];
  ownershipReason?: string | null;
  elapsedMs: number | null;
  cleanup?: { killed: number[]; inconclusive: boolean; note: string | null; rootPid: number | null };
  leftoverOwned?: number[];
  userDataRemoved?: boolean;
  probeError?: string;
  error?: string;
}

export declare function parseWindows(stdout: string): WinInfo[];
export declare function parseProcessTable(stdout: string): ProcInfo[];
export declare function normalizeWinPath(p: string): string;
export declare function winDirname(p: string): string;
export declare function ownedWindows(windows: WinInfo[], ownedPids: number[]): WinInfo[];
export declare function ownedVisibleWindows(windows: WinInfo[], ownedPids: number[]): WinInfo[];
export declare function ownershipCheck(opts: {
  table: ProcInfo[];
  rootPid: number | null | undefined;
  exeDir: string;
  baselinePids?: number[];
  probeOk?: boolean;
}): OwnershipResult;
export declare function cleanupPlan(opts: { ownership: OwnershipResult; probeOk?: boolean }): CleanupPlan;
export declare function smokeVerdict(opts: {
  probeOk: boolean;
  ownership: OwnershipResult;
  visible: boolean;
  titleMatched: boolean;
  leftoverOwned?: number[];
}): SmokeVerdict;
export declare function defaultOutPath(tmpDir?: string, now?: number): string;
export declare function isOwnedSmokeDir(dir: string | null | undefined): boolean;
type Runner = (script: string) => { ok: boolean; out: string; error: string | null };

export declare function launchScript(opts: { exe: string; appPath: string; cwd: string }): string;
export declare function parseStartOutput(stdout: string): { rootPid: number; userData: string } | null;
export declare function launchApp(
  opts: { exe: string; appPath: string; cwd: string },
  runner?: Runner,
): { ok: boolean; rootPid: number | null; userData: string | null; error: string | null };
export declare function removeUserData(dir: string | null | undefined, runner?: Runner): boolean;
export declare function windowScript(): string;
export declare function processTableScript(): string;
export declare function probeProcessTable(
  runner?: (script: string) => { ok: boolean; out: string; error: string | null },
): { probeOk: boolean; table: ProcInfo[]; error: string | null };
export declare function killProven(
  owned: number[],
  hooks: { verify: (pid: number) => boolean; kill: (pid: number) => void },
): number[];
export declare function killOwned(owned: number[], runner?: (script: string) => { ok: boolean; out: string; error: string | null }): number[];
export interface SmokeArgs {
  exe: string | null;
  out: string;
  timeoutMs: number;
  expectTitle: string;
}
export declare function parseSmokeArgs(argv: string[], cwd?: string): SmokeArgs;

export declare function runSmoke(
  args: SmokeArgs,
  deps?: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    ps?: Runner;
    probe?: (runner: Runner) => { probeOk: boolean; table: ProcInfo[]; error: string | null };
    launch?: (opts: { exe: string; appPath: string; cwd: string }) => {
      ok: boolean;
      rootPid: number | null;
      userData: string | null;
      error: string | null;
    };
    fs?: typeof import('node:fs');
  },
): Promise<SmokeReport>;
export {};
