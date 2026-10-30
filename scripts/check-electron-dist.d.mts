export type Platform = 'win32' | 'linux' | 'darwin';
export declare const PLATFORM_MARKERS: Record<Platform, string[]>;
export declare const COMMON_MARKERS: string[];
export interface DistCheck {
  ok: boolean;
  platform: string;
  missing: string[];
  foreign: string[];
}
export declare function verifyElectronDist(platform: string, entries: string[]): DistCheck;
export declare function explainFailure(result: DistCheck, distDir: string): string;
export declare function parseArgs(argv: string[], defaults: { platform: string; dist: string }): { platform: string; dist: string };
