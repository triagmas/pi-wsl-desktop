/**
 * RED gate T2 — M2 agent-config loader + skills discovery (Issue #7).
 * RED first: `src/bridge/resources/{agentConfig,skills}.ts` do not exist.
 */
import { describe, expect, it } from 'vitest';
import { loadAgentConfig } from '../../src/bridge/resources/agentConfig';
import { discoverSkills } from '../../src/bridge/resources/skills';
import { dir, file, resourceFs } from '../helpers/resourceFs';

const HOME = '/home';
const CWD = '/work/repo/src';
const SKILL_MD = (name: string, description?: string): string =>
  `---\nname: ${name}\ndescription: ${description ?? 'does things'}\n---\n# ${name}\n`;

describe('loadAgentConfig — settings scopes + project trust', () => {
  it('reads user settings, honors trust for project settings, resolves paths', async () => {
    const fs = resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file(JSON.stringify({ skills: ['skills-a'], extensions: ['-builtin:mcp'], packages: ['npm:pkg-a'] })),
            'trust.json': file(JSON.stringify({ '/work/repo': true })),
            'skills-a': dir({ 'SKILL.md': file(SKILL_MD('a')) }),
          }),
        }),
      }),
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('ref') }),
          '.pi': dir({ 'settings.json': file(JSON.stringify({ skills: ['/abs/b'] })) }),
          src: dir({}),
        }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    expect(cfg.userSettings.skills).toEqual(['skills-a']);
    expect(cfg.projectTrusted).toBe(true);
    expect(cfg.projectSettings.skills).toEqual(['/abs/b']);
    expect(cfg.diagnostics).toEqual([]);
  });

  it('treats untrusted project settings as NOT loaded (with a diagnostic)', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file('{}') }) }) }),
      work: dir({ repo: dir({ '.pi': dir({ 'settings.json': file(JSON.stringify({ skills: ['/abs/b'] })) }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    expect(cfg.projectTrusted).toBe(false);
    expect(cfg.projectSettings.skills).toEqual([]);
    expect(cfg.diagnostics.join(' ')).toMatch(/trust/i);
  });

  it('survives malformed user settings with fail-closed diagnostics', async () => {
    const fs = resourceFs({ home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{oops') }) }) }) });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/nowhere' });
    expect(cfg.userSettings.skills).toEqual([]);
    expect(cfg.diagnostics.join(' ')).toMatch(/settings/i);
  });
});

describe('discoverSkills — sources, status, provenance (Issue #7 inventory)', () => {
  const base = {
    home: dir({
      '.pi': dir({
        agent: dir({
          'settings.json': file(JSON.stringify({ skills: ['extra-skill'] })),
          'trust.json': file('{}'),
          'extra-skill': dir({ 'SKILL.md': file(SKILL_MD('extra', 'from settings')) }),
        }),
      }),
      '.agents': dir({
        skills: dir({
          'code-review': dir({ 'SKILL.md': file(SKILL_MD('code-review', 'review diffs')) }),
          'no-desc': dir({ 'SKILL.md': file('---\nname: no-desc\n---\nbody\n') }),
        }),
      }),
    }),
    work: dir({
      repo: dir({
        '.git': dir({ HEAD: file('ref') }),
        '.agents': dir({ skills: dir({ 'repo-skill': dir({ 'SKILL.md': file(SKILL_MD('repo-skill', 'repo scoped')) }) }) }),
        src: dir({}),
      }),
    }),
  };

  it('discovers user settings, user agents and project agents with provenance', async () => {
    const fs = resourceFs(base);
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    const byName = new Map(r.skills.map((s) => [s.name, s]));
    expect(byName.get('extra')?.source).toBe('user-settings');
    expect(byName.get('code-review')?.source).toBe('user-agents');
    expect(byName.get('repo-skill')?.source).toBe('project-agents');
    expect(byName.get('code-review')?.description).toBe('review diffs');
  });

  it('flags a skill without a description as invalid (skills.md: not loaded)', async () => {
    const fs = resourceFs(base);
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    const bad = r.skills.find((s) => s.name === 'no-desc');
    expect(bad?.status).toBe('invalid');
    expect(bad?.diagnostics.join(' ')).toMatch(/description/i);
  });

  it('honors `-path` exclusions as status=excluded', async () => {
    const fs = resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file(JSON.stringify({ skills: ['extra-skill', '-extra-skill'] })),
            'trust.json': file('{}'),
            'extra-skill': dir({ 'SKILL.md': file(SKILL_MD('extra', 'x')) }),
          }),
        }),
        '.agents': dir({
          skills: dir({
            'code-review': dir({ 'SKILL.md': file(SKILL_MD('code-review', 'review diffs')) }),
            'no-desc': dir({ 'SKILL.md': file('---\nname: no-desc\n---\nbody\n') }),
          }),
        }),
      }),
      work: base.work,
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    expect(r.skills.find((s) => s.name === 'extra')?.status).toBe('excluded');
  });

  it('lists package skills with the owning package as provenance', async () => {
    const fs = resourceFs({
      pkgroot: dir({
        'pi-toolbox': dir({ skills: dir({ 'box-skill': dir({ 'SKILL.md': file(SKILL_MD('box-skill', 'from pkg')) }) }) }),
        home: base.home,
        work: base.work,
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: '/pkgroot/home', cwd: '/pkgroot/work/repo/src' });
    const r = await discoverSkills({
      fs,
      cfg,
      packageDirs: [{ source: 'npm:pi-toolbox', dir: '/pkgroot/pi-toolbox' }],
    });
    const s = r.skills.find((x) => x.name === 'box-skill');
    expect(s?.source).toBe('package');
    expect(s?.package).toBe('npm:pi-toolbox');
    expect(s?.status).toBe('ok');
  });

  it('keeps the FIRST discovered skill on name collisions and reports it', async () => {
    const fs = resourceFs({
      ...base,
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('ref') }),
          '.agents': dir({
            skills: dir({
              'code-review': dir({ 'SKILL.md': file(SKILL_MD('code-review', 'repo override')) }),
              'repo-skill': dir({ 'SKILL.md': file(SKILL_MD('repo-skill', 'repo scoped')) }),
            }),
          }),
          src: dir({}),
        }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    const matches = r.skills.filter((s) => s.name === 'code-review');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe('user-agents'); // user agents win over project
    expect(r.diagnostics.join(' ')).toMatch(/collision/i);
  });

  it('marks a settings-listed skill whose directory is absent as missing', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file(JSON.stringify({ skills: ['ghost'] })), 'trust.json': file('{}') }) }) }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    expect(r.skills.find((s) => s.name === 'ghost')?.status).toBe('missing');
  });
});

describe('skills — review round 1 fixes (IMPORTANT #2, MINOR f)', () => {
  it('[IMPORTANT#2] project-settings relative entries resolve from <projectRoot>/.pi, not the agent dir', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file(JSON.stringify({ '/work/repo': true })) }) }) }),
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('ref') }),
          '.pi': dir({ skills: dir({ 'rel-skill': dir({ 'SKILL.md': file(SKILL_MD('rel-skill', 'project relative')) }) }), 'settings.json': file(JSON.stringify({ skills: ['./skills/rel-skill'] })) }),
          src: dir({}),
        }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    const s = r.skills.find((x) => x.name === 'rel-skill');
    expect(s).toMatchObject({ source: 'project-settings', status: 'ok' }); // resolved from <root>/.pi
  });

  it('[MINOR f] an EXCLUDED skill does not consume its name — a loadable same-name skill stays visible', async () => {
    const homeDir = dir({
      '.pi': dir({
        agent: dir({
          'settings.json': file(JSON.stringify({ skills: ['-~/.agents/skills/code-review'] })),
          'trust.json': file('{}'),
        }),
      }),
      '.agents': dir({
        skills: dir({ 'code-review': dir({ 'SKILL.md': file(SKILL_MD('code-review', 'user copy')) }) }),
      }),
    });
    const fs = resourceFs({
      home: homeDir,
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('ref') }),
          '.agents': dir({ skills: dir({ 'code-review': dir({ 'SKILL.md': file(SKILL_MD('code-review', 'project copy')) }) }) }),
          src: dir({}),
        }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: CWD });
    const r = await discoverSkills({ fs, cfg, packageDirs: [] });
    const visible = r.skills.filter((x) => x.name === 'code-review');
    // the excluded user copy must not hide the loadable project copy
    expect(visible.some((x) => x.source === 'project-agents' && x.status === 'ok')).toBe(true);
  });
});