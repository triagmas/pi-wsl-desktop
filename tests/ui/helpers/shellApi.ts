import { vi } from 'vitest';
import type { DesktopApi } from '../../../src/renderer/api';
import type { RendererSnapshot } from '../../../src/renderer/types';

export const READY_SNAPSHOT: RendererSnapshot = {
  phase: 'ready',
  attempt: 0,
  distro: 'Ubuntu',
  distros: ['Ubuntu'],
  runtime: {
    distro: 'Ubuntu',
    node: { path: '/home/u/.local/bin/node', version: 'v22.23.2' },
    pi: { path: '/home/u/.local/bin/pi', version: '9.9.9', rpcSupported: true },
    agentDir: '/home/u/.pi/agent',
  },
};

export interface ShellMockApi extends DesktopApi {
  _retry: ReturnType<typeof vi.fn>;
  _request: ReturnType<typeof vi.fn>;
  _getStatus: ReturnType<typeof vi.fn>;
  _saveAppearance: ReturnType<typeof vi.fn>;
  _windowControls: {
    minimize: ReturnType<typeof vi.fn>;
    maximize: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

/** Shared UI-test API double for the App Shell suites. */
export function makeApi(initial: RendererSnapshot = READY_SNAPSHOT): ShellMockApi {
  let current = initial;
  const subs: Array<(s: RendererSnapshot) => void> = [];
  const retry = vi.fn(async () => {
    current = { ...current, phase: 'connecting' };
    for (const cb of subs) cb(current);
    return current;
  });
  const selectDistro = vi.fn(async (distro: string) => {
    current = { ...current, distro, phase: 'ready' };
    for (const cb of subs) cb(current);
    return current;
  });
  const request = vi.fn(async (method: string) => {
    if (method === 'listProjects') return { projects: [], diagnostics: [] };
    if (method === 'listSessions') return { sessions: [], diagnostics: [] };
    if (method === 'listSkills') return { skills: [], diagnostics: [] };
    if (method === 'listPackages')
      return { packages: [], builtins: [], settingsExtensions: [], diagnostics: [] };
    if (method === 'listMcpServers')
      return { servers: [], builtinEnabled: false, logDiagnostics: [], diagnostics: [] };
    if (method === 'getRuntimeInfo') return current.runtime;
    return { ok: true };
  });
  const getStatus = vi.fn(async () => current);
  const saveAppearance = vi.fn(async () => undefined);
  const windowControls = {
    minimize: vi.fn(async () => undefined),
    maximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const api: ShellMockApi = {
    request: request as DesktopApi['request'],
    getStatus: getStatus as unknown as DesktopApi['getStatus'],
    retry: retry as unknown as DesktopApi['retry'],
    listDistros: async () => current.distros ?? [],
    selectDistro: selectDistro as unknown as DesktopApi['selectDistro'],
    onStateChange: (cb) => {
      subs.push(cb);
      return () => undefined;
    },
    onChatEvent: () => () => undefined,
    getAppearance: async () => undefined,
    saveAppearance,
    resetAppearance: async () => undefined,
    // D2: frameless window controls — observable in the shell contract tests.
    windowControls,
    _retry: retry,
    _request: request,
    _getStatus: getStatus,
    _saveAppearance: saveAppearance,
    _windowControls: windowControls,
  };
  return api;
}
