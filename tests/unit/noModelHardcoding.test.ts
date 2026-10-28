/**
 * UI21-F2 product contract: this app owns NO model catalogue.
 *
 * The owner's requirement is explicit — no provider/model may be mandatory,
 * defaulted or hard-coded, including Xiaomi MiMo and OpenCode DeepSeek. Every
 * model shown in the UI must come from the installed Pi at runtime
 * (`get_available_models` / `get_state`).
 *
 * This guard fails the build if a provider/model identifier leaks into
 * production source, so a "helpful" default cannot be reintroduced silently.
 * Scope is the FUNCTIONAL path — bridge, shared contract, chat controller and
 * the chat pane. Design Lab mock-ups and the approved theme presets are
 * excluded on purpose: they contain illustrative copy (a mock settings row,
 * a board cell showing "MiMo v2.6") and palette names like `claude`/`codex`.
 * Those are visuals the owner approved, not a source of model selection.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src/renderer', 'src/bridge', 'src/shared', 'src/main', 'src/preload'];

/** Approved visual mock-ups / palette names — not model selection sources. */
const EXCLUDED = [
  'src/shared/design/presets.ts', // theme palettes named claude/codex (approved §9.2)
  'src/renderer/ui/BoardCellsV5.tsx', // design-lab board: illustrative copy
  'src/renderer/ui/BoardScreen.tsx',
  'src/renderer/ui/SettingsScreen.tsx',
  'src/renderer/SettingsView.tsx', // mock settings row text in the design composition
];

/** Provider/model identifiers that must never appear in production source. */
const FORBIDDEN = [
  'xiaomi',
  'mimo',
  'opencode',
  'deepseek',
  'claude',
  'anthropic',
  'openai',
  'gemini',
  'qwen',
  'glm',
  'grok',
  'kimi',
  'token-plan',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = SCANNED_DIRS.flatMap((d) => walk(path.join(ROOT, d))).filter(
  (f) => !EXCLUDED.includes(path.relative(ROOT, f).split(path.sep).join('/')),
);

describe('UI21-F2: no hard-coded models, providers or defaults in production source', () => {
  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))('%s is model-agnostic', (label, file) => {
    const text = readFileSync(file, 'utf8').toLowerCase();
    const hits = FORBIDDEN.filter((needle) => text.includes(needle));
    expect(hits, `${label} mentions ${hits.join(', ')} — the catalog must come from Pi at runtime`).toEqual([]);
  });
});
