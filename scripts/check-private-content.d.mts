export declare const MAX_INSPECT_BYTES: number;
export declare const BINARY_EXTENSIONS: string[];
export declare const PLACEHOLDER_USERS: string[];
export declare const PLACEHOLDER_VALUES: RegExp;
export interface Finding {
  file: string;
  rule: string;
}
export interface FileInspection {
  ok: boolean;
  skipped: string | null;
  findings: Finding[];
}
export declare function privateRules(): Array<{ id: string; title: string; re: RegExp }>;
export declare function findPrivate(text: string): string | null;
export declare function findSensitiveName(file: string): string | null;
export declare function inspectFile(
  file: string,
  io?: { readFileSync: (p: string, enc: 'utf8') => string; statSync: (p: string) => { size: number } },
): FileInspection;
export declare function inspectFiles(files: string[]): { ok: boolean; findings: Finding[] };
