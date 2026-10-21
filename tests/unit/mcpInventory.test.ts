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

describe('MCP — review round 1 fixes (IMPORTANT #4, MINOR c/d)', () => {
  const fsWith = (userMcpRaw: string, projMcpRaw?: string): ReturnType<typeof resourceFs> =>
    resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file('{}'),
            'trust.json': file(JSON.stringify({ '/work/repo': true })),
            'mcp.json': file(userMcpRaw),
          }),
        }),
      }),
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('ref') }),
          '.pi': projMcpRaw === undefined ? dir({}) : dir({ 'mcp.json': file(projMcpRaw) }),
          src: dir({}),
        }),
      }),
    });

  it('[IMPORTANT#4] a PARTIAL project overlay merges with the user entry (mcp.md semantics)', async () => {
    const fs = fsWith(
      JSON.stringify({ mcpServers: { boxed: { command: '/usr/bin/boxed', args: ['--serve'], env: { BOX_TOKEN: 'v' } } } }),
      JSON.stringify({ mcpServers: { boxed: { enabled: false } } }),
    );
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    const boxed = r.servers.find((s) => s.name === 'boxed');
    // inherited command/args/envKeys from the user entry, overlay flag honoured
    expect(boxed).toMatchObject({
      scope: 'project',
      hasProjectOverride: true,
      transport: 'stdio',
      command: '/usr/bin/boxed',
      args: ['--serve'],
      envKeys: ['BOX_TOKEN'],
      enabled: false,
    });
  });

  it('[MINOR d] full servers report enabled=true; overlay disable reports false', async () => {
    const fs = fsWith(JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://a.invalid/mcp' } } }));
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    expect(r.servers.find((s) => s.name === 'a')?.enabled).toBe(true);
  });

  it('[MINOR c] log aggregation accepts ONLY server names matching the mcp name charset', async () => {
    const log = [
      '2026-01-01T00:00:00Z [alpha] error alpha: boom',
      '2026-01-01T00:00:01Z [bad name! ] error x: private',
      '2026-01-01T00:00:02Z [ok_srv-1] warning ok: hmm',
      '',
    ].join('\n');
    const fs = fsWith(JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://a.invalid/mcp' } } }));
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    // place the log beside the user mcp.json
    const fs2 = resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file('{}'),
            'trust.json': file(JSON.stringify({ '/work/repo': true })),
            'mcp.json': file(JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://a.invalid/mcp' } } })),
            'mcp.log': file(log),
          }),
        }),
      }),
      work: dir({ repo: dir({ '.git': dir({ HEAD: file('ref') }), '.pi': dir({}), src: dir({}) }) }),
    });
    const r = await discoverMcp({ fs: fs2, cfg });
    expect(r.logDiagnostics).toContain('alpha ERROR 1');
    expect(r.logDiagnostics.some((x) => x.includes('ok_srv-1'))).toBe(true);
    expect(r.logDiagnostics.some((x) => x.includes('bad name'))).toBe(false);
    expect(r.logDiagnostics.some((x) => x.includes('private'))).toBe(false);
    void fs;
  });
});

describe('MCP — round 2: mcp.md merge semantics (N1)', () => {
  const fsWith = (user: Record<string, unknown>, proj: Record<string, unknown>): ReturnType<typeof resourceFs> =>
    resourceFs({
      home: dir({
        '.pi': dir({
          agent: dir({
            'settings.json': file('{}'),
            'trust.json': file(JSON.stringify({ '/work/repo': true })),
            'mcp.json': file(JSON.stringify({ mcpServers: user })),
          }),
        }),
      }),
      work: dir({
        repo: dir({
          '.git': dir({ HEAD: file('ref') }),
          '.pi': dir({ 'mcp.json': file(JSON.stringify({ mcpServers: proj })) }),
          src: dir({}),
        }),
      }),
    });

  it('(a) a project entry WITH transport fully REPLACES the user entry (no inheritance)', async () => {
    const fs = fsWith(
      {
        box: { command: '/user/box', args: ['--user'], env: { U_TOKEN: 'u' }, enabled: false, description: 'user desc' },
      },
      { box: { command: '/project/box' } },
    );
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    const box = r.servers.find((s) => s.name === 'box');
    expect(box).toMatchObject({ scope: 'project', hasProjectOverride: true, command: '/project/box', enabled: true });
    expect(box?.args).toEqual([]); // user args NOT inherited
    expect(box?.envKeys).toEqual([]); // user env NOT inherited
  });

  it('(b) a transport-less overlay overrides ONLY enabled/exposure/toolExposure and keeps the rest', async () => {
    const fs = fsWith(
      { box: { command: '/user/box', args: ['--keep'], env: { U_TOKEN: 'u' }, enabled: true } },
      { box: { enabled: false, args: ['--override-attempt'], description: 'project attempt' } },
    );
    const cfg = await loadAgentConfig({ fs, home: HOME, cwd: '/work/repo/src' });
    const r = await discoverMcp({ fs, cfg });
    const box = r.servers.find((s) => s.name === 'box');
    expect(box).toMatchObject({ enabled: false, command: '/user/box' });
    expect(box?.args).toEqual(['--keep']); // overlay may NOT touch args
    expect(box?.envKeys).toEqual(['U_TOKEN']); // env kept per mcp.md
  });
});
