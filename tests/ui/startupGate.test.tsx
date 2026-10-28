/**
 * UI21 F1-B Startup Gate R01 (P1) — преждевременный DISCONNECTED.
 *
 * Наблюдение владельца: при запуске в UI всплывало
 * `DISCONNECTED: connection is not ready`, хотя подключение шло нормально.
 * Причина: левая панель запрашивала listProjects/listSessions на монтировании,
 * не проверяя `connectionReady`; `WslConnection.request` до READY законно
 * отвергает запрос, а текст ошибки немедленно показывался пользователю.
 *
 * Контракт: пока соединение не READY, рендерер НЕ обращается к мосту и не
 * показывает ошибку — только честное «Подключение…». После READY — ровно
 * один запрос проектов/сессий.
 */
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { LeftSidebar } from '../../src/renderer/shell/LeftSidebar';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const NOT_READY: RendererSnapshot = { phase: 'discovering', attempt: 0, distro: null, distros: null, runtime: null };
const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: ['Ubuntu'], runtime: null };

interface Recorded {
  method: string;
}

function makeApi(initial: RendererSnapshot) {
  let current = initial;
  const subs: Array<(s: RendererSnapshot) => void> = [];
  const calls: Recorded[] = [];
  const request = vi.fn(async (method: string) => {
    calls.push({ method });
    // Ровно как настоящий WslConnection.request до READY.
    if (current.phase !== 'ready') throw new Error('DISCONNECTED: connection is not ready');
    if (method === 'listProjects')
      return { projects: [{ id: 'p1', path: '/w/p1', sessionCount: 0, lastActivityAt: null }], diagnostics: [] };
    if (method === 'listSessions') return { sessions: [], diagnostics: [] };
    if (method === 'getRuntimeInfo') return current.runtime;
    return { ok: true };
  });
  const api: DesktopApi = {
    request: request as DesktopApi['request'],
    getStatus: async () => current,
    retry: vi.fn(async () => current) as unknown as DesktopApi['retry'],
    listDistros: async () => current.distros ?? [],
    selectDistro: vi.fn(async () => current) as unknown as DesktopApi['selectDistro'],
    onStateChange: (cb) => {
      subs.push(cb);
      return () => undefined;
    },
    onChatEvent: () => () => undefined,
    getAppearance: async () => undefined,
    saveAppearance: async () => undefined,
    resetAppearance: async () => undefined,
  };
  return {
    api,
    calls,
    request,
    emit: (snap: RendererSnapshot) => {
      current = snap;
      for (const cb of subs) cb(snap);
    },
  };
}

const sidebarProps = {
  moduleTabs: [],
  collapsed: false,
  width: 260,
  view: 'chat',
  activeFile: null,
  onToggleCollapsed: () => undefined,
  onNewChat: () => undefined,
  onView: () => undefined,
  onPickSession: () => undefined,
};

describe('startup gate — no premature DISCONNECTED', () => {
  it('left sidebar makes NO bridge request while the connection is not ready', async () => {
    const mock = makeApi(NOT_READY);
    render(<LeftSidebar api={mock.api} connectionReady={false} {...sidebarProps} />);
    await new Promise((r) => setTimeout(r, 250));
    expect(mock.calls).toEqual([]);
    // Никакой ошибки транспорта пользователю: только ожидание.
    expect(screen.queryByTestId('sidebar-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/connection is not ready/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-connecting')).toBeInTheDocument();
  });

  it('fetches projects and sessions exactly once after READY', async () => {
    const mock = makeApi(NOT_READY);
    const { rerender } = render(<LeftSidebar api={mock.api} connectionReady={false} {...sidebarProps} />);
    await new Promise((r) => setTimeout(r, 150));
    expect(mock.calls).toEqual([]);

    // Соединение становится готовым: мост начинает отвечать, панель грузит дерево.
    mock.emit(READY);
    rerender(<LeftSidebar api={mock.api} connectionReady {...sidebarProps} />);
    await waitFor(() => expect(mock.calls.filter((c) => c.method === 'listProjects')).toHaveLength(1));
    expect(mock.calls.filter((c) => c.method === 'listSessions')).toHaveLength(1);
    expect(await screen.findByTestId('project-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-connecting')).not.toBeInTheDocument();
  });

  it('App shows no DISCONNECTED text during startup and loads the tree after READY', async () => {
    const mock = makeApi(NOT_READY);
    render(<App api={mock.api} />);
    // Даём эффектам сработать так, как они срабатывали до фикса.
    await new Promise((r) => setTimeout(r, 400));
    expect(mock.calls).toEqual([]);
    expect(screen.queryByText(/connection is not ready/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('status-phase')).toHaveTextContent(/поиск|подключени/i);

    mock.emit(READY);
    await waitFor(() => expect(mock.calls.some((c) => c.method === 'listProjects')).toBe(true));
    expect(screen.queryByText(/connection is not ready/i)).not.toBeInTheDocument();
  });
});
