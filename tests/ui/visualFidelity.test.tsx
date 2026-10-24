import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';
import { makeApi } from './helpers/shellApi';

/**
 * UI-A R02 visual fidelity contracts (Issue #21 owner feedback 6367211992):
 * slim branded window chrome (no native application menu remnants), truthful
 * empty state, honest sidebar labels, zero-height terminal, pinned composer.
 * Blocks land per correction task (T1–T6); each one was RED before GREEN.
 */

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };

const PROJECT = { id: '/work/repo', path: '/work/repo', sessionCount: 2, lastActivityAt: '2026-10-19T02:00:00.000Z' };

function session(overrides: Record<string, unknown>) {
  return {
    id: 'sess-x',
    file: '/root/sessions/plain-name.jsonl',
    root: '/root',
    projectId: '/work/repo',
    projectPath: '/work/repo',
    name: 'Named session',
    createdAt: '2026-10-19T01:00:00.000Z',
    updatedAt: '2026-10-19T02:00:00.000Z',
    sizeBytes: 512,
    version: 3,
    availability: 'ok',
    activeWrite: false,
    diagnostics: null,
    ...overrides,
  };
}

const SESSION_OLDER = session({
  id: 'sess-older',
  file: '/root/sessions/older-chat.jsonl',
  name: 'Старый диалог',
  createdAt: '2026-10-18T01:00:00.000Z',
});
const SESSION_NEWER = session({
  id: 'sess-newer',
  file: '/root/sessions/newer-chat.jsonl',
  name: null,
  createdAt: '2026-10-19T09:30:00.000Z',
});

/** R03 п.2: honest provisional new-session contract (bridge-shaped). */
const NEW_DIALOG = {
  id: 'fake-session-0001',
  file: '/root/sessions/2026-10-24T08-00-00-000Z_new-dialog.jsonl',
  root: '/root',
  projectId: '/work/repo',
  projectPath: '/work/repo',
  name: 'Новый диалог',
  createdAt: null,
  updatedAt: '2026-10-24T08:00:00.000Z',
  sizeBytes: 0,
  version: 1,
  availability: 'empty',
  activeWrite: false,
  diagnostics: null,
};
const NEW_STATE = {
  sessionId: NEW_DIALOG.id,
  sessionFile: NEW_DIALOG.file,
  isStreaming: false,
  isCompacting: false,
  messageCount: 0,
  model: null,
  thinkingLevel: 'medium',
};

interface Route {
  listProjects?: unknown;
  listSessions?: unknown;
  readSession?: unknown;
  newSession?: unknown;
}

const EMPTY_READ = {
  header: null,
  entries: [],
  leafId: null,
  nextCursor: null,
  truncated: false,
  partialTrailing: false,
  diagnostics: [],
  availability: 'ok',
};

function makeRoutedApi(route: Route = {}): { api: DesktopApi; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (method: string) => {
    if (method === 'listProjects') return route.listProjects ?? { projects: [], diagnostics: [] };
    if (method === 'listSessions') return route.listSessions ?? { sessions: [], diagnostics: [] };
    if (method === 'readSession') return route.readSession ?? EMPTY_READ;
    if (method === 'newSession') return route.newSession ?? { state: null, session: null };
    if (method === 'openSession') return { state: null };
    if (method === 'closeSession') return { closed: true };
    if (method === 'getState') return { state: null };
    if (method === 'subscribeEvents') return { subscribed: true };
    return {};
  });
  const base = makeApi(READY);
  const api: DesktopApi = {
    ...base,
    request: request as DesktopApi['request'],
  };
  return { api, request };
}

describe('T1 window chrome (A1)', () => {
  it('renders the slim topbar with the designed brand mark and wordmark', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.getByTestId('shell-topbar')).toBeInTheDocument();
    expect(screen.getByTestId('brand-mark')).toBeInTheDocument();
    expect(screen.getByText('Pi WSL Desktop')).toBeInTheDocument();
  });
});

describe('T2 left sidebar truthfulness (A2)', () => {
  it('labels the new-chat action honestly — it creates a REAL dialog over Pi RPC (R03 п.2)', async () => {
    const user = userEvent.setup();
    const { api, request } = makeRoutedApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION_OLDER, SESSION_NEWER], diagnostics: [] },
      newSession: { state: NEW_STATE, session: NEW_DIALOG },
    });
    render(<App api={api} moduleDefinitions={[]} />);
    const button = await screen.findByTestId('sidebar-new-chat');
    expect(button).toHaveTextContent('Новый диалог');
    expect(button).toHaveAttribute('title', expect.stringContaining('Pi RPC'));
    await user.click(button);
    // REAL creation is called — no relabelled open-latest fallback
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'newSession')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('chat-head')).toBeInTheDocument());
    expect(screen.getByTestId('chat-head')).toHaveTextContent('Новый диалог');
    // the provisional record wears no warning badge and no tab framing
    expect(screen.queryByText(/⚠/)).toBeNull();
    expect(screen.queryByTestId('tab-chat')).toBeNull();
    expect(screen.getByTestId('chat-composer')).toBeEnabled();
  });

  it('never closes a live chat implicitly — creating while busy asks first (R03 п.2)', async () => {
    const user = userEvent.setup();
    const { api, request } = makeRoutedApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION_OLDER], diagnostics: [] },
      newSession: { state: NEW_STATE, session: NEW_DIALOG },
    });
    render(<App api={api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('session-sess-older'));
    const input = await screen.findByTestId('chat-composer');
    await user.type(input, 'busy first');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    // chat slot live (open/sending) — creation must ask, never auto-close
    await waitFor(() => expect(screen.getByTestId('chat-status')).toBeInTheDocument());
    expect(request.mock.calls.some((c) => c[0] === 'closeSession')).toBe(false);
    await user.click(screen.getByTestId('sidebar-new-chat'));
    const guard = await screen.findByTestId('switch-guard');
    expect(guard).toHaveTextContent(/новый диалог/i);
    expect(screen.getByTestId('switch-confirm')).toHaveTextContent(/создать/i);
    // cancel: nothing is closed, nothing is created
    await user.click(screen.getByTestId('switch-cancel'));
    expect(screen.queryByTestId('switch-guard')).toBeNull();
    expect(request.mock.calls.some((c) => c[0] === 'newSession')).toBe(false);
    expect(request.mock.calls.some((c) => c[0] === 'closeSession')).toBe(false);
    // confirm: fail-closed close FIRST, then create
    await user.click(screen.getByTestId('sidebar-new-chat'));
    await screen.findByTestId('switch-confirm');
    await user.click(screen.getByTestId('switch-confirm'));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'newSession')).toBe(true));
    const methods = request.mock.calls.map((c) => c[0]);
    expect(methods.indexOf('closeSession')).toBeGreaterThan(-1);
    expect(methods.indexOf('newSession')).toBeGreaterThan(methods.indexOf('closeSession'));
    await waitFor(() => expect(screen.getByTestId('chat-head')).toHaveTextContent('Новый диалог'));
  });

  it('falls back to the session file stem instead of an opaque id fragment', async () => {
    const { api } = makeRoutedApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION_NEWER], diagnostics: [] },
    });
    render(<App api={api} moduleDefinitions={[]} />);
    // name === null ⇒ the readable file stem, NOT the raw id prefix.
    expect(await screen.findByTestId('session-sess-newer')).toHaveTextContent('newer-chat');
    expect(screen.getByTestId('session-sess-newer')).not.toHaveTextContent('sess-new');
  });

  it('uses one icon family in navigation: no emoji glyphs, no text-labeled Чат row', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await screen.findByTestId('nav-resources');
    // The only chat entry point is the icon-only brand button — there is no
    // second text «Чат» navigation row duplicating it (owner diagnosis).
    expect(screen.queryByText('Чат')).not.toBeInTheDocument();
    for (const glyph of ['💬', '🗀', '⚙', '⛃', '＋', '▮‹', '▮›', '◦', '⋯', '|›', '›', '⌄']) {
      expect(screen.queryByText(glyph)).not.toBeInTheDocument();
    }
  });

  it('shows the real distro subtitle in the sidebar connection status', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const status = await screen.findByTestId('sidebar-connection');
    expect(status).toHaveTextContent('Pi подключён');
    expect(status).toHaveTextContent('Ubuntu');
    expect(status).toHaveTextContent('WSL');
  });
});

describe('T3 center chat workspace (A3/A6)', () => {
  it('shows a quiet empty state with a REAL create action and an honest secondary CTA', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const empty = await screen.findByTestId('chat-empty');
    // Owner diagnosis: the giant StatusPanel card must be gone from chat.
    expect(screen.queryByTestId('status-phase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runtime')).not.toBeInTheDocument();
    // R03 п.2: creation is REAL — the primary CTA says exactly what it does
    const create = screen.getByTestId('empty-new-chat');
    expect(create).toHaveTextContent('Новый диалог');
    expect(create).toHaveAttribute('title', expect.stringContaining('Pi RPC'));
    expect(empty).toContainElement(create);
    // The old fallback keeps ITS OWN honest label — never relabelled as create
    const cta = screen.getByTestId('empty-open-latest');
    expect(empty).toContainElement(cta);
    expect(cta).toHaveTextContent('Открыть последний диалог');
  });

  it('renders no terminal strip at all while the dock is closed (zero height)', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.queryByTestId('terminal-slot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-dock')).not.toBeInTheDocument();
  });

  it('opens a picked session straight into its conversation with a live composer (R03 п.1)', async () => {
    const { api } = makeRoutedApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION_OLDER], diagnostics: [] },
      readSession: {
        header: { type: 'session', version: 3, id: 'x', timestamp: 'T', cwd: '/work/repo' },
        entries: [
          {
            type: 'message',
            id: 'm1',
            parentId: null,
            timestamp: 'T',
            raw: { type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: 'stored line', timestamp: 1 } },
          },
        ],
        leafId: null,
        nextCursor: null,
        truncated: false,
        partialTrailing: false,
        diagnostics: [],
        availability: 'ok',
      },
    });
    render(<App api={api} moduleDefinitions={[]} />);
    await userEvent.click(await screen.findByTestId('session-sess-older'));
    // R03 п.1: the conversation IS the chat — no История/Чат tab framing and
    // no invitation block; the stored history is visible at once …
    await screen.findByText('stored line');
    expect(screen.queryByTestId('tab-history')).toBeNull();
    expect(screen.queryByTestId('tab-chat')).toBeNull();
    expect(screen.queryByTestId('open-chat')).toBeNull();
    expect(screen.queryByText(/официальный Pi RPC/i)).toBeNull();
    // … and the composer is usable immediately (its draft survives switches).
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
    expect(screen.getByTestId('chat-composer')).toBeEnabled();
  });

  it('keeps the Pi RPC write-boundary explanation in Settings → Connection, not in the workspace (R03 п.1)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi(READY)} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-tab-connection'));
    // the technical explanation lives with the connection diagnostics …
    await screen.findByTestId('rpc-write-boundary-note');
    expect(screen.getByTestId('rpc-write-boundary-note')).toHaveTextContent(/официальный Pi RPC/);
    // … and the chat workspace carries no diagnostic lecture copy
    await user.click(await screen.findByTestId('nav-chat'));
    expect(screen.queryByTestId('rpc-write-boundary-note')).toBeNull();
    expect(screen.queryByText(/каждый шаг требует вашего действия/i)).toBeNull();
  });
});

describe('T4 right details panel (A4)', () => {
  it('shows an honest Обзор tab only — no invented files or checks', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('open-details'));
    const panel = screen.getByTestId('right-sidebar');
    expect(within(panel).getByRole('heading', { name: 'Детали действия' })).toBeInTheDocument();
    const overview = within(panel).getByRole('tab', { name: 'Обзор' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    // M1 events carry no structured file diffs — the «Файлы» tab must not
    // exist in UI-A (honest absence, owner A4).
    expect(within(panel).queryByRole('tab', { name: 'Файлы' })).not.toBeInTheDocument();
    expect(within(panel).getByTestId('details-empty')).toBeInTheDocument();
    expect(within(panel).getByTestId('details-summary')).toHaveTextContent('0 инстр.');
    // no invented counts anywhere in the panel
    expect(panel.textContent).not.toMatch(/\d+\s*файл/);
    expect(panel.textContent).not.toMatch(/Все проверки пройдены/);
  });
});

describe('T5 resources skills view (A5)', () => {
  const SKILLS_FIXTURE = {
    skills: [
      {
        name: 'brainstorming',
        description: 'Помогает превратить идею в понятный план',
        source: 'user-agents',
        dir: '/home/u/.agents/skills/brainstorming',
        status: 'ok',
        disableModelInvocation: false,
        diagnostics: [],
      },
      {
        name: 'code-review',
        description: 'Review diffs before merge',
        source: 'project',
        dir: '/work/repo/.pi/skills/code-review',
        status: 'excluded',
        disableModelInvocation: false,
        diagnostics: [],
      },
    ],
    diagnostics: [],
  };

  it('renders the reference header, search, source filter and compact rows', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'listSkills') return SKILLS_FIXTURE;
      return {};
    });
    const base = makeApi(READY);
    const api: DesktopApi = { ...base, request: request as DesktopApi['request'] };
    const user = userEvent.setup();
    render(<App api={api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('nav-resources'));
    expect(screen.getByRole('heading', { name: 'Ресурсы' })).toBeInTheDocument();
    expect(screen.getByText('Навыки, расширения и подключения вашего Pi')).toBeInTheDocument();
    const search = screen.getByPlaceholderText('Найти навык...');
    expect(screen.getByRole('combobox', { name: 'Источник' })).toBeInTheDocument();
    const rows = await screen.findAllByTestId('skill-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('brainstorming');
    expect(rows[0]).toHaveTextContent('Помогает превратить идею в понятный план');
    expect(rows[0]).toHaveTextContent('user-agents');
    // client-side search narrows the list
    await user.type(search, 'code');
    const filtered = await screen.findAllByTestId('skill-row');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toHaveTextContent('code-review');
  });
});
