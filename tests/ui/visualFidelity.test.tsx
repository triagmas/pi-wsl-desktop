import { render, screen, waitFor } from '@testing-library/react';
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

interface Route {
  listProjects?: unknown;
  listSessions?: unknown;
}

function makeRoutedApi(route: Route = {}): { api: DesktopApi; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (method: string) => {
    if (method === 'listProjects') return route.listProjects ?? { projects: [], diagnostics: [] };
    if (method === 'listSessions') return route.listSessions ?? { sessions: [], diagnostics: [] };
    if (method === 'openSession') return { state: null };
    if (method === 'closeSession') return { closed: true };
    if (method === 'getState') return { state: null };
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
  it('labels the new-chat action honestly — it opens the most recent real session', async () => {
    const user = userEvent.setup();
    const { api } = makeRoutedApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION_OLDER, SESSION_NEWER], diagnostics: [] },
    });
    render(<App api={api} moduleDefinitions={[]} />);
    const button = await screen.findByTestId('sidebar-new-chat');
    expect(button).toHaveAttribute('title', expect.stringContaining('Pi CLI'));
    await user.click(button);
    // The most recent REAL session (by createdAt) becomes the active chat.
    await waitFor(() => expect(screen.getByTestId('chat-head')).toBeInTheDocument());
    expect(screen.getByTestId('chat-head')).toHaveTextContent('newer-chat');
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
  it('shows a quiet empty state: no diagnostics card, one honest CTA', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const empty = await screen.findByTestId('chat-empty');
    // Owner diagnosis: the giant StatusPanel card must be gone from chat.
    expect(screen.queryByTestId('status-phase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runtime')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Новый диалог' })).not.toBeInTheDocument();
    const cta = screen.getByTestId('empty-open-latest');
    expect(empty).toContainElement(cta);
    expect(cta).toHaveTextContent('Открыть последний диалог');
  });

  it('renders no terminal strip at all while the dock is closed (zero height)', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.queryByTestId('terminal-slot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-dock')).not.toBeInTheDocument();
  });

  it('opens a picked session directly into the chat tab with a bottom composer', async () => {
    const { api } = makeRoutedApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION_OLDER], diagnostics: [] },
    });
    render(<App api={api} moduleDefinitions={[]} />);
    await userEvent.click(await screen.findByTestId('session-sess-older'));
    // No extra hop: the chat is already the active tab of the detail view.
    const pane = await screen.findByTestId('chat-pane');
    expect(pane).toBeInTheDocument();
    // The composer is anchored at the bottom of the pane, disabled until the
    // chat is actually opened — drafts survive view/theme switches (App state).
    const composer = screen.getByTestId('chat-composer');
    expect(composer).toBeInTheDocument();
    expect(composer).toHaveAttribute('disabled');
    expect(screen.getByTestId('open-chat')).toBeInTheDocument();
  });
});
