/**
 * M2 token measurement — three fixed synthetic benchmark tasks (Issue #12).
 *
 * Classes follow TOKEN_EFFICIENCY.md §5:
 *  - A: status/documents (mechanical) — exact computed token in the reply;
 *  - B: narrow code + TDD — a fenced JS snippet must satisfy fixed cases;
 *  - C: security review — every seeded issue must be named.
 *
 * Everything here is synthetic and non-secret by construction: no real
 * repository content, no credentials, no personal data. Checkers are pure
 * functions so they can be verified without any model call.
 */
import vm from 'node:vm';

export interface TaskCheck {
  ok: boolean;
  detail: string;
}

export interface AcceptanceTask {
  id: 'A' | 'B' | 'C';
  title: string;
  prompt: string;
  check: (reply: string) => TaskCheck;
}

/** Fixture diff: exactly 5 added and 3 removed content lines. */
const FIXTURE_DIFF_A = [
  'diff --git a/fixture.js b/fixture.js',
  '--- a/fixture.js',
  '+++ b/fixture.js',
  '@@ -1,6 +1,8 @@',
  ' const alpha = 1;',
  '+const beta = 2;',
  '+const gamma = 3;',
  ' const delta = 4;',
  '+const epsilon = 5;',
  '-const old1 = 0;',
  '-const old2 = 0;',
  '-const old3 = 0;',
  ' const zeta = 6;',
  '+const eta = 7;',
  '+const theta = 8;',
].join('\n');

export const expectedTokenA = 'DIFF-STAT 5 3';

export function checkTaskA(reply: string): TaskCheck {
  const ok = new RegExp(`${expectedTokenA.replace(' ', '\\s+')}(?!\\d)`).test(reply);
  return { ok, detail: ok ? 'exact token found' : `missing exact token "${expectedTokenA}"` };
}

const FIXTURE_DIFF_C = [
  'diff --git a/server.js b/server.js',
  '--- a/server.js',
  '+++ b/server.js',
  '@@ -10,6 +10,7 @@',
  ' async function readUserFile(req, res) {',
  '-  const p = path.join(USERS_DIR, req.query.name);',
  '+  // sanitize input',
  '+  const p = path.join(USERS_DIR, req.query.name + ".json");',
  '   return fs.readFile(p);',
  ' }',
  ' async function startUpdater(cfg) {',
  '-  spawn("node", ["updater.js"]);',
  '+  spawn("node", ["--api-key", cfg.apiKey, "updater.js"]);',
  ' }',
  ' function applySettings(newSettings) {',
  '+  fs.writeFileSync(settingsPath, JSON.stringify(newSettings));',
  ' }',
].join('\n');

function extractFencedCode(reply: string): string | null {
  const m = /```(?:js|javascript)?\n([\s\S]*?)```/.exec(reply);
  return m ? m[1] : null;
}

export function checkTaskB(reply: string): TaskCheck {
  const code = extractFencedCode(reply);
  if (!code) return { ok: false, detail: 'no fenced js code block in reply' };
  let fn: unknown;
  try {
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    fn = vm.runInNewContext(`${code}\n;chunkString`, sandbox, { timeout: 500 });
  } catch (e) {
    return { ok: false, detail: `snippet failed to evaluate: ${(e as Error).message}` };
  }
  if (typeof fn !== 'function') return { ok: false, detail: 'snippet does not define chunkString' };
  const cases: Array<{ name: string; input: string; size: number; expected?: string[]; mustThrow?: boolean }> = [
    { name: 'abcdef/2', input: 'abcdef', size: 2, expected: ['ab', 'cd', 'ef'] },
    { name: 'abc/5', input: 'abc', size: 5, expected: ['abc'] },
    { name: 'empty/1', input: '', size: 1, expected: [] },
    { name: 'a/0 throws', input: 'a', size: 0, mustThrow: true },
    { name: 'a/1.5 throws', input: 'a', size: 1.5, mustThrow: true },
  ];
  for (const c of cases) {
    try {
      const out = (fn as (s: string, n: number) => string[])(c.input, c.size);
      if (c.mustThrow) return { ok: false, detail: `case ${c.name}: expected throw, got ${JSON.stringify(out)}` };
      if (JSON.stringify(out) !== JSON.stringify(c.expected)) {
        return { ok: false, detail: `case ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(out)}` };
      }
    } catch (e) {
      if (!c.mustThrow) return { ok: false, detail: `case ${c.name}: unexpected throw: ${(e as Error).message}` };
    }
  }
  return { ok: true, detail: 'all cases pass' };
}

const SEEDED_ISSUES_C: Array<{ name: string; any: string[]; also?: string[] }> = [
  { name: 'path traversal', any: ['traversal'] },
  { name: 'secret via argv', any: ['argv', 'args', 'process list'], also: ['secret', 'key', 'credential'] },
  { name: 'write without confirmation/backup', any: ['confirm', 'consent', 'backup'] },
];

export function checkTaskC(reply: string): TaskCheck {
  const lower = reply.toLowerCase();
  const missing = SEEDED_ISSUES_C.filter(
    (issue) =>
      !issue.any.some((kw) => lower.includes(kw)) ||
      (issue.also !== undefined && !issue.also.some((kw) => lower.includes(kw))),
  ).map((i) => i.name);
  return missing.length === 0
    ? { ok: true, detail: 'all 3 seeded issues named' }
    : { ok: false, detail: `missing seeded issues: ${missing.join('; ')}` };
}

export const ACCEPTANCE_TASKS: AcceptanceTask[] = [
  {
    id: 'A',
    title: 'status/documents: count a synthetic diff',
    prompt: [
      'Task (synthetic fixture, no tools needed):',
      'Count the added and removed content lines in this unified diff (ignore headers, hunk markers and context lines):',
      '',
      FIXTURE_DIFF_A,
      '',
      `Reply with exactly: ${expectedTokenA}`,
    ].join('\n'),
    check: checkTaskA,
  },
  {
    id: 'B',
    title: 'narrow code + TDD: implement chunkString',
    prompt: [
      'Task (synthetic fixture, no tools needed):',
      'Implement a JavaScript function chunkString(s, size) that:',
      '- returns an array of consecutive substrings of s, each of length size, the last one shorter if needed;',
      '- returns [] for the empty string;',
      '- throws RangeError when size is not an integer >= 1.',
      'Output exactly one fenced js code block defining chunkString and nothing else.',
    ].join('\n'),
    check: checkTaskB,
  },
  {
    id: 'C',
    title: 'security review: find seeded issues in a synthetic diff',
    prompt: [
      'Task (synthetic fixture):',
      'Review this unified diff for security issues and list each one:',
      '',
      FIXTURE_DIFF_C,
      '',
      'Reply with a short numbered list naming every security issue you find.',
    ].join('\n'),
    check: checkTaskC,
  },
];
