export declare const DEFAULT_CANDIDATES: string[];
export interface WinElectron {
  exe: string;
  dist: string;
  fromEnv: boolean;
}
export declare function posixPathToWindows(p: string, platform?: string): string;
export declare function windowsPathToPosix(p: string, platform?: string): string;
export declare function resolveWinElectron(
  env: Record<string, string | undefined>,
  cwd: string,
  exists: (p: string) => boolean,
): WinElectron | null;
