/**
 * T7 — M2 Resources UI (RTL): inventory rendering, two-phase write boundary
 * (preview → explicit confirm → apply), redaction display, cancel path,
 * error surfacing, inert hostile content.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourcesView } from '../../src/renderer/ResourcesView';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };

interface Route {
  listSkills?: unknown;
  listPackages?: unknown;
  listMcpServers?: unknown;
  preview?: (params: Record<string, unknown>) => unknown;
  apply?: (params: Record<string, unknown>) => unknown;
  rollback?: (params: Record<string, unknown>) => unknown;
  errors?: Record<string, unknown>;
}

function makeApi(route: Route = {}) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, ...(params ? { params } : {}) });
    if (route.errors && method in route.errors) throw route.errors[method];
    switch (method) {
      case 'listSkills':
        return route.listSkills ?? { skills: [], diagnostics: [] };
      case 'listPackages':
        return route.listPackages ?? { packages: [], builtins: [], settingsExtensions: [], diagnostics: [] };
      case 'listMcpServers':
        return route.listMcpServers ?? { servers: [], builtinEnabled: true, logDiagnostics: [], diagnostics: [] };
      case 'previewResourceOp':
        return route.preview ? route.preview(params ?? {}) : { plan: dummyPlan };
      case 'applyResourceOp':
        return route.apply ? route.apply(params ?? {}) : dummyApply;
      case 'rollbackResourceOp':
        return route.rollback ? route.rollback(params ?? {}) : { ok: true, restored: ['/x/settings.json'] };
      default:
        return {};
    }
  });
  const api: DesktopApi = {
    request: request as DesktopApi['request'],
    getStatus: async () => READY,
    retry: vi.fn(async () => READY),
    listDistros: async () => [],
    selectDistro: vi.fn(async () => READY),
    onStateChange: () => () => undefined,
    onChatEvent: () => () => undefined,
  };
  return { api, calls };
}

const dummyPlan = {
  planId: 'op-1',
  kind: 'package-install',
  description: 'pi install npm:demo',
  command: ['pi', 'install', 'npm:demo'],
  commandRedacted: false,
  filesTouched: ['/home/u/.pi/agent/settings.json'],
  backupId: 'b-1',
  expiresAt: Date.now() + 60_000,
};
const dummyApply = { ok: true, opId: 'op-1', output: 'Installed', backupId: 'b-1', filesTouched: ['/home/u/.pi/agent/settings.json'], verified: true };

const SKILLS = {
  skills: [
    {
      name: 'code-review',
      dir: '/home/u/.agents/skills/code-review',
      source: 'user-agents',
      package: null,
      description: 'review diffs <img src=x onerror=alert(1)>',
      status: 'ok',
      disableModelInvocation: false,
      diagnostics: [],
    },
    {
      name: 'ghost',
      dir: '/home/u/.pi/agent/ghost',
      source: 'user-settings',
      package: null,
      description: null,
      status: 'missing',
      disableModelInvocation: false,
      diagnostics: ['SKILL.md: not found'],
    },
  ],
  diagnostics: ['skill name collision: "x" — first discovered wins'],
};

describe('ResourcesView — skills inventory', () => {
  it('renders rows with provenance/status and keeps hostile content inert', async () => {
    const { api } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);
    const rows = await screen.findAllByTestId('skill-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('code-review');
    expect(rows[0]).toHaveTextContent('user-agents');
    expect(rows[1]).toHaveTextContent('missing');
    // hostile description stays TEXT — no element was parsed
    expect(screen.getByText(/review diffs <img src=x/)).toBeTruthy();
    expect(document.querySelector('.res-panel img')).toBeNull();
    expect(document.querySelector('.res-panel [onerror]')).toBeNull();
    expect(screen.getByTestId('res-diagnostics')).toHaveTextContent(/collision/);
    // missing skill cannot be toggled
    expect(screen.getAllByTestId('skill-toggle')[1]).toHaveProperty('disabled', true);
  });

  it('toggling previews a skill-set op (no apply before explicit confirm)', async () => {
    const { api, calls } = makeApi({ listSkills: SKILLS });
    render(<ResourcesView api={api} />);
    const btns = await screen.findAllByTestId('skill-toggle');
    await userEvent.click(btns[0] as HTMLElement);
    await screen.findByTestId('op-plan');
    const previewCall = calls.find((c) => c.method === 'previewResourceOp');
    expect(previewCall?.params).toMatchObject({ kind: 'skill-set', source: '/home/u/.agents/skills/code-review', disable: true });
    expect(calls.some((c) => c.method === 'applyResourceOp')).toBe(false); // nothing applied yet

    await userEvent.click(screen.getByTestId('op-cancel'));
    expect(screen.queryByTestId('op-plan')).toBeNull();
    expect(calls.some((c) => c.method === 'applyResourceOp')).toBe(false);
    expect(screen.getByTestId('res-notice')).toHaveTextContent(/отменена/i);
  });
});

describe('ResourcesView — packages write flow', () => {
  it('preview → confirm → apply(confirm: true) → rollback available', async () => {
    const { api, calls } = makeApi({
      listPackages: {
        packages: [
          { source: 'npm:demo', kind: 'npm', scope: 'user', path: '/p', present: true, declaredRef: null, diagnostics: [] },
        ],
        builtins: [{ name: 'mcp', enabled: true }],
        settingsExtensions: ['builtin:codemode'],
        diagnostics: [],
      },
    });
    render(<ResourcesView api={api} />);
    await userEvent.click(await screen.findByTestId('res-tab-packages'));
    await screen.findByTestId('packages-table');
    expect(screen.getByTestId('builtins-list')).toHaveTextContent('mcp — включено');

    // install form → preview
    await userEvent.type(screen.getByTestId('install-source'), 'npm:other');
    await userEvent.click(screen.getByTestId('install-submit'));
    await screen.findByTestId('op-plan');
    expect(screen.getByTestId('op-command')).toHaveTextContent('pi install npm:demo'); // default plan from route
    expect(calls.some((c) => c.method === 'applyResourceOp')).toBe(false);

    // per-row remove → preview called with row source
    await userEvent.click(screen.getByTestId('pkg-remove'));
    await waitFor(() => {
      const previews = calls.filter((c) => c.method === 'previewResourceOp');
      expect(previews.at(-1)?.params).toMatchObject({ kind: 'package-remove', source: 'npm:demo' });
    });
    await screen.findByTestId('op-plan');

    // confirm → apply with literal confirm:true
    await userEvent.click(screen.getByTestId('op-confirm'));
    await screen.findByTestId('op-result');
    const applyCall = calls.find((c) => c.method === 'applyResourceOp');
    expect(applyCall?.params).toEqual({ planId: 'op-1', confirm: true });
    expect(screen.getByTestId('op-result')).toHaveTextContent('проверка: подтверждена');

    // rollback path
    await userEvent.click(screen.getByTestId('op-rollback'));
    await waitFor(() => expect(calls.some((c) => c.method === 'rollbackResourceOp')).toBe(true));
    const rollbackCall = calls.find((c) => c.method === 'rollbackResourceOp');
    expect(rollbackCall?.params).toEqual({ opId: 'op-1', confirm: true });
    await waitFor(() => expect(screen.getByTestId('res-notice')).toHaveTextContent(/откат/i));
  });
});

describe('ResourcesView — MCP tab', () => {
  it('shows env KEYS only, clears the form after preview, redacted badge shown', async () => {
    const previewed: Array<Record<string, unknown>> = [];
    const { api, calls } = makeApi({
      listMcpServers: {
        servers: [
          {
            name: 'boxed',
            scope: 'user',
            transport: 'stdio',
            command: '/usr/bin/boxed',
            args: [],
            envKeys: ['BOX_TOKEN'],
            hasProjectOverride: false,
            oauthConfigured: false,
            enabled: true,
            diagnostics: [],
          },
          {
            name: 'offbox',
            scope: 'project',
            transport: 'http',
            command: 'https://off.invalid/mcp',
            args: [],
            envKeys: [],
            hasProjectOverride: true,
            oauthConfigured: false,
            enabled: false,
            diagnostics: [],
          },
        ],
        builtinEnabled: true,
        logDiagnostics: ['boxed ERROR 1'],
        diagnostics: [],
      },
      preview: (params) => {
        previewed.push(params);
        return { plan: { ...dummyPlan, command: ['pi', 'mcp', 'add', 'newbox', '--env', 'NEW_TOKEN=***'], commandRedacted: true, description: 'pi mcp add newbox' } };
      },
    });
    render(<ResourcesView api={api} />);
    await userEvent.click(await screen.findByTestId('res-tab-mcp'));
    await screen.findByTestId('mcp-table');
    expect(screen.getAllByTestId('mcp-envkeys')[0]).toHaveTextContent('BOX_TOKEN');
    expect(screen.getByTestId('mcp-table')).not.toHaveTextContent('BOX_TOKEN=');
    expect(screen.getByTestId('mcp-builtin')).toHaveTextContent('включён');
    expect(screen.getByTestId('mcp-disabled')).toHaveTextContent('выключен'); // [r1 MINOR d]
    expect(screen.getByTestId('mcp-log')).toHaveTextContent('boxed ERROR 1');

    await userEvent.type(screen.getByTestId('mcp-name'), 'newbox');
    await userEvent.type(screen.getByTestId('mcp-endpoint'), 'https://new.invalid/mcp');
    await userEvent.type(screen.getByTestId('mcp-env-key'), 'NEW_TOKEN');
    await userEvent.type(screen.getByTestId('mcp-env-value'), 'raw-secret-input');
    await userEvent.click(screen.getByTestId('mcp-add-submit'));

    await screen.findByTestId('op-plan');
    // URL endpoints are http-only: the renderer drops the stdio-only env pair
    // (the bridge rejects env+url as INVALID_REQUEST)
    expect(previewed[0]).toMatchObject({ kind: 'mcp-add', source: 'newbox' });
    expect(previewed[0]).not.toHaveProperty('env');
    expect(screen.getByTestId('op-redacted')).toHaveTextContent('секреты скрыты');
    // form cleared after preview — secret leaves the renderer state
    expect(screen.getByTestId('mcp-env-value')).toHaveProperty('value', '');
    expect(screen.getByTestId('mcp-name')).toHaveProperty('value', '');
    expect(calls.some((c) => c.method === 'applyResourceOp')).toBe(false);

    await userEvent.click(screen.getByTestId('op-cancel'));
    expect(screen.queryByTestId('op-plan')).toBeNull();
    expect(calls.some((c) => c.method === 'applyResourceOp')).toBe(false);
  });

  it('surfaces bridge errors with their stable code', async () => {
    const { api } = makeApi({ errors: { listMcpServers: new Error('INVALID_REQUEST: mcp.json: malformed JSON (ignored)') } });
    render(<ResourcesView api={api} />);
    await userEvent.click(await screen.findByTestId('res-tab-mcp'));
    const box = await screen.findByTestId('res-error');
    expect(box).toHaveTextContent('INVALID_REQUEST');
    expect(box).toHaveTextContent('malformed JSON');
  });

  it('shows FAIL state with rollback still offered when backup exists', async () => {
    const { api } = makeApi({
      listSkills: SKILLS,
      preview: () => ({ plan: dummyPlan }),
      apply: () => ({ ok: false, opId: 'op-1', output: 'cli failed: boom', backupId: 'b-1', filesTouched: dummyPlan.filesTouched, verified: false }),
    });
    render(<ResourcesView api={api} />);
    const toggles = await screen.findAllByTestId('skill-toggle');
    await userEvent.click(toggles[0] as HTMLElement);
    await screen.findByTestId('op-plan');
    await userEvent.click(screen.getByTestId('op-confirm'));
    const result = await screen.findByTestId('op-result');
    expect(result).toHaveTextContent('FAIL');
    expect(result).toHaveTextContent('не подтверждена');
    expect(screen.getByTestId('op-rollback')).toBeTruthy();
  });
});
