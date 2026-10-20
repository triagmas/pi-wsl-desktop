/**
 * RED gate T4 — MCP config-only inventory (Issue #7).
 * `pi mcp list` CONNECTS to servers and spawns children — the manager must
 * therefore work from the config files alone. RED first:
 * `src/bridge/resources/mcp.ts` does not exist.
 */
import { describe, expect, it } from 'vitest';
import { loadAgentConfig } from '../../src/bridge/resources/agentConfig';
import { discoverMcp } from '../../src/bridge/resources/mcp';
import { dir, file, resourceFs } from '../helpers/resourceFs';

const HOME = '/home';
const userMcp = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    mcpServers: {
      context7: { type: 'http', url: 'https://mcp.example.com/mcp', ...extra },
      localtool: {
        command: '/usr/bin/localtool',
        args: ['--port', '1234'],
        env: { API_TOKEN: 'super-secret-value', OTHER: 'plain' },
      },
    },
  });

describe('discoverMcp — config parsing, scopes, redaction (NO connections)', () => {
  it('parses stdio and http servers; env VALUES never leave the bridge', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file('{}'), 'mcp.json': file(userMcp()) }) }) }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    const byName = new Map(r.servers.map((s) => [s.name, s]));
    expect(byName.get('localtool')).toMatchObject({ transport: 'stdio', command: '/usr/bin/localtool', args: ['--port', '1234'], envKeys: ['API_TOKEN', 'OTHER'], scope: 'user', hasProjectOverride: false });
    expect(byName.get('context7')).toMatchObject({ transport: 'http', command: 'https://mcp.example.com/mcp', args: [] });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('super-secret-value'); // redaction invariant
    expect(serialized).not.toContain('API_TOKEN='); // no KEY=VALUE echoes
  });

  it('trusted project mcp.json shadows the same-name user server (override flag)', async () => {
    const fs = resourceFs({
      home: dir({
        '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file(JSON.stringify({ '/work/repo': true })), 'mcp.json': file(userMcp()) }) }),
      }),
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('x') }),
          '.pi': dir({ 'mcp.json': file(JSON.stringify({ mcpServers: { context7: { type: 'http', url: 'https://project.example/mcp' } } })) }),
          src: dir({}),
        }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    const ctx = r.servers.filter((s) => s.name === 'context7');
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toMatchObject({ scope: 'project', hasProjectOverride: true, command: 'https://project.example/mcp' });
    expect(r.servers.some((s) => s.name === 'localtool')).toBe(true); // user-only server survives
  });

  it('untrusted project config is NOT read (diagnostic instead)', async () => {
    const fs = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file('{}'), 'mcp.json': file(userMcp()) }) }) }),
      work: dir({
        repo: dir({ '.git': dir({ HEAD: file('x') }), '.pi': dir({ 'mcp.json': file(JSON.stringify({ mcpServers: { evil: { type: 'http', url: 'https://evil' } } })) }), src: dir({}) }),
      }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    expect(r.servers.some((s) => s.name === 'evil')).toBe(false);
    expect(r.diagnostics.join(' ')).toMatch(/trust/i);
  });

  it('flags invalid server names (mcp.md charset) and malformed JSON without crashing', async () => {
    const fs = resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file('{}'),
            'trust.json': file('{}'),
            'mcp.json': file(JSON.stringify({ mcpServers: { 'bad name!': { type: 'http', url: 'https://x' }, good: { type: 'http', url: 'https://y' } } })),
          }),
        }),
      }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    expect(r.servers.some((s) => s.name === 'good')).toBe(true);
    expect(r.diagnostics.join(' ')).toMatch(/invalid server name/i);

    const fs2 = resourceFs({
      home: dir({ '.pi': dir({ agent: dir({ 'settings.json': file('{}'), 'trust.json': file('{}'), 'mcp.json': file('{broken') }) }) }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg2 = await loadAgentConfig({ fs: fs2, home: HOME, cwd: '/work/repo/src' });
    const r2 = await discoverMcp({ fs: fs2, cfg: cfg2 });
    expect(r2.servers).toEqual([]);
    expect(r2.diagnostics.join(' ')).toMatch(/mcp\.json/i);
  });

  it('builtin MCP state follows settings extensions (-builtin:mcp)', async () => {
    const fs = resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file(JSON.stringify({ extensions: ['-builtin:mcp'] })),
            'trust.json': file('{}'),
            'mcp.json': file(userMcp()),
          }),
        }),
      }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    expect(r.builtinEnabled).toBe(false);
  });

  it('aggregates mcp.log levels only — raw log lines never travel', async () => {
    const log = [
      '2026-01-01T00:00:00Z [context7] error context7: private payload leaked',
      '2026-01-01T00:00:01Z [context7] error context7: again',
      '2026-01-01T00:00:02Z [other] warn other: hmm',
      '',
    ].join('\n');
    const fs = resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file('{}'),
            'trust.json': file('{}'),
            'mcp.json': file(userMcp()),
            'mcp.log': file(log),
          }),
        }),
      }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('x') }), src: dir({}) }) }),
    });
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    expect(r.logDiagnostics).toContain('context7 ERROR 2');
    expect(r.logDiagnostics.some((x) => x.startsWith('other '))).toBe(true);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('private payload leaked');
    expect(serialized).not.toContain('hmm');
  });

  it('never imports child_process (no connection probes in the inventory path)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/bridge/resources/mcp.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/(?:import|require)[^\n]*child_process|\bexecFileSync?\(|\bspawnSync\(|\bspawn\(/);
    expect(src).not.toMatch(/mcp-auth/); // credentials stay unread
  });
});
