/**
 * Docs contract for the compact AGENTS.md + four project Skills package
 * (Issue #14, PR #15).
 *
 * Repository Contract CI validates that relative link *paths* exist, but it
 * splits on "#" first — so it can never see a dead section anchor. This test
 * closes that gap and additionally pins the requirements the compaction of
 * AGENTS.md must not silently drop.
 *
 * Anchor slugs use GitHub's algorithm (lowercase, drop chars outside
 * [\w\- ] with Unicode word chars, then spaces -> hyphens). Verified against
 * two links that already resolve on GitHub: PRODUCT.md#8-тестирование-и-критерии-приёмки
 * and README.md#7-дорожная-карта.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(process.cwd());
const SKILLS = [
  'pi-desktop-status',
  'pi-desktop-development',
  'pi-desktop-safety',
  'pi-desktop-review',
] as const;

function read(rel: string): string {
  // Windows checkouts use CRLF (git autocrlf); normalize so line-oriented
  // parsing and anchor extraction behave identically on every platform.
  return readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function githubSlug(heading: string): string {
  return heading
    .replace(/^#+\s*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .replace(/ /g, '-');
}

function headingsOf(rel: string): Set<string> {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return new Set();
  return new Set(
    read(rel)
      .split('\n')
      .filter((l) => /^#{1,6} /.test(l))
      .map(githubSlug),
  );
}

function trackedMarkdown(): string[] {
  return execFileSync('git', ['ls-files', '*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Does any single line contain every token (case-insensitive)? */
function hasLineWith(text: string, tokens: RegExp[]): boolean {
  return text.split('\n').some((line) => tokens.every((t) => t.test(line)));
}

describe('AGENTS.md + project Skills docs contract (Issue #14)', () => {
  it('every intra-repo markdown anchor link points at a heading that exists', () => {
    const broken: string[] = [];
    for (const file of trackedMarkdown()) {
      const text = read(file);
      for (const m of text.matchAll(/\]\(([^)\s]*?)#([^)\s]+)\)/g)) {
        const target = m[1] ?? '';
        const anchor = m[2] ?? '';
        if (target.startsWith('http')) continue;
        const line = text.slice(0, m.index).split('\n').length;
        const base = target ? path.join(path.dirname(file), target) : file;
        if (!existsSync(path.join(ROOT, base))) {
          broken.push(`${file}:${line} -> ${target} (target missing)`);
        } else if (!headingsOf(base).has(anchor)) {
          broken.push(`${file}:${line} -> ${target}#${anchor} (anchor dead)`);
        }
      }
    }
    expect(broken, `dead links:\n${broken.join('\n')}`).toEqual([]);
  });

  it('all four project skills carry valid, routable frontmatter', () => {
    for (const name of SKILLS) {
      const raw = read(`.pi/skills/${name}/SKILL.md`);
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      expect(fm, `${name}: missing YAML frontmatter`).toBeTruthy();
      const body = fm![1]!;
      const declaredName = /^name:\s*(.+)$/m.exec(body)?.[1]?.trim();
      const description = /^description:\s*(.+)$/m.exec(body)?.[1]?.trim();
      expect(declaredName, `${name}: missing name`).toBe(name);
      expect(description, `${name}: missing description`).toBeTruthy();
      expect(description!.length, `${name}: description too short to route`).toBeGreaterThan(40);
    }
  });

  it('keeps the mandatory Skills rules that lived in the old AGENTS.md §4', () => {
    const agents = read('AGENTS.md');

    // Skill instructions that conflict with the project contract or are unsafe
    // must not be executed, and the reason must be stated.
    expect(
      hasLineWith(agents, [/не исполнять/i, /противоречащ/i, /причин/i]),
      'AGENTS.md lost the rule: do not execute conflicting/unsafe skill instructions, state the reason',
    ).toBe(true);

    // Handing a task to a subagent requires passing the relevant skill
    // requirements and verifying their application from the report.
    expect(
      hasLineWith(agents, [/subagent/i, /Skills/i, /требован/i, /применен/i]),
      'AGENTS.md lost the rule: pass skill requirements to a subagent and verify their use',
    ).toBe(true);

    // Nested reference files only on request; new/changed skills always re-read.
    expect(
      hasLineWith(agents, [/reference/i, /требован/i]),
      'AGENTS.md lost the rule: read nested reference files only on demand',
    ).toBe(true);
    expect(
      hasLineWith(agents, [/перечит/i, /изменённ/i]),
      'AGENTS.md lost the rule: always re-read new or changed skills',
    ).toBe(true);
  });

  it('documents that project skills need a project-trust decision', () => {
    const agents = read('AGENTS.md');
    expect(
      hasLineWith(agents, [/trust/i, /(--approve|\/trust)/i]),
      'AGENTS.md does not say .pi/skills stays undiscovered without a project-trust decision',
    ).toBe(true);
  });

  it('keeps the off / low / medium / high thinking routing', () => {
    const agents = read('AGENTS.md');
    for (const level of ['off', 'low', 'medium', 'high'] as const) {
      expect(agents, `AGENTS.md lost thinking level ${level}`).toMatch(
        new RegExp(`\`${level}\``),
      );
    }
  });
});
