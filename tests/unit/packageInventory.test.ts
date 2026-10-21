/**
 * RED gate T3 — packages/extensions inventory (Issue #7).
 * RED first: `src/bridge/resources/packages.ts` does not exist.
 */
import { describe, expect, it } from 'vitest';
import { loadAgentConfig } from '../../src/bridge/resources/agentConfig';
import { discoverPackages } from '../../src/bridge/resources/packages';
import { dir, file, resourceFs } from '../helpers/resourceFs';

const HOME = '/home';

const fixture = (): ReturnType<typeof resourceFs> =>
  resourceFs({
    home: dir({
      '.pi': dir({
        agent: dir({
          'settings.json': file(
            JSON.stringify({
              packages: ['npm:pi-subagents', 'git:github.com/obra/superpowers@v7.0.0', './local-tool', { source: 'npm:filtered', skills: [] }],
              extensions: ['builtin:codemode', '-builtin:mcp'],
            }),
          ),
          'trust.json': file('{}'),
          npm: dir({ node_modules: dir({ 'pi-subagents': dir({ 'package.json': file('{"name":"pi-subagents","version":"9.9.9"}') }) }) }),
          git: dir({ 'github.com': dir({ obra: dir({ superpowers: dir({ 'package.json': file('{"name":"superpowers"}') }) }) }) }),
          'local-tool': dir({ 'package.json': file('{"name":"local-tool"}') }),
        }),
      }),
    }),
    work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
  });

describe('discoverPackages — sources, resolved paths, presence (pi list parity shape)', () => {
  it('classifies npm/git/local/object-form entries and resolves install paths', async () => {
    const fs = fixture();
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverPackages({ fs, cfg });
    const bySource = new Map(r.packages.map((p) => [p.source, p]));
    expect(bySource.get('npm:pi-subagents')).toMatchObject({ kind: 'npm', scope: 'user', present: true, path: '/home/.pi/agent/npm/node_modules/pi-subagents' });
    expect(bySource.get('git:github.com/obra/superpowers@v7.0.0')).toMatchObject({ kind: 'git', present: true, declaredRef: 'v7.0.0' });
    expect(bySource.get('./local-tool')).toMatchObject({ kind: 'local', present: true, path: '/home/.pi/agent/local-tool' });
    expect(bySource.get('npm:filtered')).toMatchObject({ kind: 'npm', present: false }); // not installed on disk
    expect(bySource.get('npm:pi-subagents')?.declaredRef).toBeNull();
  });

  it('reports builtin extension enablement with project override and `-builtin:` disables', async () => {
    const fs = fixture();
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverPackages({ fs, cfg });
    const byName = new Map(r.builtins.map((b) => [b.name, b.enabled]));
    expect(byName.get('codemode')).toBe(true);
    expect(byName.get('mcp')).toBe(false); // -builtin:mcp
    expect(byName.get('tool-search')).toBe(true); // default on
    expect(byName.get('llama.cpp')).toBe(true);
    expect(r.settingsExtensions).toContain('builtin:codemode');
  });

  it('scopes project packages only when trusted, with provenance scope=project', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file(JSON.stringify({ '/work/repo': true })) }) }) }),
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('x') }),
          '.pi': dir({ 'settings.json': file(JSON.stringify({ packages: ['npm:proj-only'] })) }),
          src: dir({}),
        }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverPackages({ fs, cfg });
    expect(r.packages.find((p) => p.source === 'npm:proj-only')).toMatchObject({ scope: 'project', present: false });
  });

  it('unknown source shapes degrade to diagnostics, never crash', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file(JSON.stringify({ packages: ['wheel:bogus', 42 as unknown as string] })), 'trust.json': file('{}') }) }) }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverPackages({ fs, cfg });
    expect(r.packages.find((p) => p.source === 'wheel:bogus')).toMatchObject({ kind: 'local', present: false });
    expect(r.diagnostics.join(' ')).toMatch(/unknown|unsupported/i);
  });
});
