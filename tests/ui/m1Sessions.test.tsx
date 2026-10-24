/**
 * RED gate T8a — Sessions & Chat renderer (M1): project/session lists,
 * read-only history preview, pagination, conflict/diagnostics states, and
 * inert rendering of hostile content (no arbitrary HTML/JS).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionsView } from '../../src/renderer/SessionsView';
import { SafeMarkdown } from '../../src/renderer/SafeMarkdown';
import type { DesktopApi } from '../../src/renderer/api';
import type { ChatEventT } from '../../src/shared/m1Protocol';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };

interface Route {
  listProjects?: unknown;
  listSessions?: unknown;
  readSession?: (params: Record<string, unknown>) => unknown;
  searchSessions?: unknown;
  errors?: Record<string, unknown>;
}

function makeApi(route: Route = {}) {
  const chatSubs: Array<(p: unknown) => void> = [];
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (route.errors && method in route.errors) throw route.errors[method];
    switch (method) {
      case 'subscribeEvents':
        return { subscribed: true };
      case 'listProjects':
        return route.listProjects ?? { projects: [], diagnostics: [] };
      case 'listSessions':
        return route.listSessions ?? { sessions: [], diagnostics: [] };
      case 'readSession':
        return route.readSession ? route.readSession(params ?? {}) : { header: null, entries: [], leafId: null, nextCursor: null, truncated: false, partialTrailing: false, diagnostics: [], availability: 'ok' };
      case 'searchSessions':
        return route.searchSessions ?? { matches: [], truncated: false };
      case 'openSession':
        return { state: null };
      case 'closeSession':
        return { closed: true };
      case 'getState':
        return { state: null };
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
    onChatEvent: (cb) => {
      chatSubs.push(cb);
      return () => {
        chatSubs.length = 0;
      };
    },
        getAppearance: async () => undefined,
        saveAppearance: async () => undefined,
        resetAppearance: async () => undefined,
  };
  return { api, request, chatSubs, emit: (p: ChatEventT) => [...chatSubs].forEach((cb) => cb(p)) };
}

const PROJECT = { id: '/work/repo', path: '/work/repo', sessionCount: 2, lastActivityAt: '2026-10-19T02:00:00.000Z' };
const SESSION = {
  id: 'sess-1',
  file: '/root/--work-repo--/s1.jsonl',
  root: '/root',
  projectId: '/work/repo',
  projectPath: '/work/repo',
  name: 'Refactor auth',
  createdAt: '2026-10-19T01:00:00.000Z',
  updatedAt: '2026-10-19T02:00:00.000Z',
  sizeBytes: 512,
  version: 3,
  availability: 'ok',
  activeWrite: false,
  diagnostics: null,
};
const BROKEN = { ...SESSION, id: 'sess-2', file: '/root/--work-repo--/s2.jsonl', name: null, availability: 'corrupt', diagnostics: 'invalid session header', activeWrite: true };

describe('SessionsView — discovery UI', () => {
  it('subscribes to chat events before anything else and lists projects/sessions', async () => {
    const { api, request } = makeApi({ listProjects: { projects: [PROJECT], diagnostics: [] }, listSessions: { sessions: [SESSION, BROKEN], diagnostics: [] } });
    render(<SessionsView api={api} />);
    await screen.findByText('/work/repo');
    await screen.findByText('Refactor auth');
    // subscribe-before-prompt contract
    expect(request.mock.calls.find((c) => c[0] === 'subscribeEvents')).toBeTruthy();
  });

  it('shows empty state when there are no sessions at all', async () => {
    const { api } = makeApi();
    render(<SessionsView api={api} />);
    await screen.findByText(/Сессий не найдено/i);
  });

  it('shows an error box with retry when discovery fails (no eternal spinner)', async () => {
    const { api, request } = makeApi({ errors: { listProjects: new Error('WSL unavailable') } });
    render(<SessionsView api={api} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('WSL unavailable');
    request.mockImplementation(async (method: string) => {
      if (method === 'listProjects') return { projects: [PROJECT], diagnostics: [] };
      if (method === 'listSessions') return { sessions: [], diagnostics: [] };
      return { subscribed: true };
    });
    await userEvent.click(screen.getByRole('button', { name: /повторить/i }));
    await screen.findByText('/work/repo');
  });

  it('marks active-write and corrupt sessions with visible diagnostics', async () => {
    const { api } = makeApi({ listProjects: { projects: [PROJECT], diagnostics: [] }, listSessions: { sessions: [SESSION, BROKEN], diagnostics: [] } });
    render(<SessionsView api={api} />);
    expect(await screen.findByText('Refactor auth')).toBeTruthy();
    expect(screen.getByText(/запись/i)).toBeTruthy(); // activeWrite badge
    expect(screen.getByText(/invalid session header/i)).toBeTruthy(); // diagnostics
    expect(screen.getByText(/⚠/)).toBeTruthy();
  });
});

describe('SessionsView — readiness deadline (no eternal spinner, SPEC §7)', () => {
  it('surfaces BRIDGE_TIMEOUT with retry when the bridge never becomes ready', async () => {
    const chatSubs: Array<(p: unknown) => void> = [];
    const stateSubs: Array<(s: RendererSnapshot) => void> = [];
    const DISCOVERING: RendererSnapshot = { phase: 'discovering', attempt: 0, distro: null, distros: null, runtime: null };
    const api: DesktopApi = {
      request: vi.fn(async () => ({})) as DesktopApi['request'],
      getStatus: async () => DISCOVERING,
      retry: vi.fn(async () => DISCOVERING),
      listDistros: async () => [],
      selectDistro: vi.fn(async () => DISCOVERING),
      onStateChange: (cb) => {
        stateSubs.push(cb);
        return () => undefined;
      },
      onChatEvent: (cb) => {
        chatSubs.push(cb);
        return () => undefined;
      },
          getAppearance: async () => undefined,
          saveAppearance: async () => undefined,
          resetAppearance: async () => undefined,
    };
    render(<SessionsView api={api} readyDeadlineMs={30} />);
    const alert = await screen.findByRole('alert', undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent('BRIDGE_TIMEOUT');
    expect(screen.queryByTestId('spinner')).toBeNull();
    expect(screen.getByRole('button', { name: /повторить/i })).toBeTruthy();
  });
});

describe('SessionsView — history preview (read-only)', () => {
  const readResult = (entries: unknown[], nextCursor: string | null, truncated: boolean, diagnostics: unknown[] = []) => ({
    header: { type: 'session', version: 3, id: 'x', timestamp: 'T', cwd: '/work/repo' },
    entries,
    leafId: nextCursor,
    nextCursor,
    truncated,
    partialTrailing: false,
    diagnostics,
    availability: 'ok',
  });
  const entry = (id: string, role: string, content: unknown, parentId: string | null = null) => ({
    type: 'message',
    id,
    parentId,
    timestamp: 'T',
    raw: { type: 'message', id, parentId, message: { role, content, timestamp: 1 } },
  });

  it('opens a session detail and renders messages from the preview', async () => {
    const { api } = makeApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION], diagnostics: [] },
      readSession: () =>
        readResult(
          [entry('m1', 'user', 'hello world'), entry('m2', 'assistant', [{ type: 'text', text: 'hi there!' }], 'm1')],
          null,
          false,
        ),
    });
    render(<SessionsView api={api} />);
    await userEvent.click(await screen.findByText('Refactor auth'));
    // R03 п.1: the conversation renders immediately — no История/Чат tabs.
    await screen.findByText('hello world');
    expect(screen.getByText('hi there!')).toBeTruthy();
  });

  it('paginates: “load continuation” appends NEWER entries after the first page (chronological order)', async () => {
    let call = 0;
    const { api } = makeApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION], diagnostics: [] },
      readSession: (params) => {
        call += 1;
        // the real reader cursor is strictly forward: the NEXT page contains
        // LATER entries (sessionReader p1=['a','b'], p2=['c','d'])
        if (params.sinceEntryId) return readResult([entry('m2', 'assistant', 'later message')], null, false);
        return readResult([entry('m1', 'user', 'first message')], 'm1', true);
      },
    });
    render(<SessionsView api={api} />);
    await userEvent.click(await screen.findByText('Refactor auth'));
    // R03 п.1: no tab hop — history loads into the conversation directly.
    await screen.findByText('first message');
    const more = await screen.findByRole('button', { name: /загрузить продолжение/i });
    await userEvent.click(more);
    await screen.findByText('later message');
    const bubbles = Array.from(document.querySelectorAll('.history-entries .bubble')).map((n) => n.textContent ?? '');
    expect(bubbles[0]).toContain('first message');
    expect(bubbles[1]).toContain('later message');
    expect(screen.queryByRole('button', { name: /загрузить продолжение/i })).toBeNull();
    expect(call).toBe(2);
  });

  it('renders hostile content as inert text (no elements, no handlers)', async () => {
    const hostile = '<img src=x onerror="alert(1)"> and <script>alert(2)</script>';
    const { api } = makeApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION], diagnostics: [] },
      readSession: () => readResult([entry('m1', 'user', hostile)], null, false),
    });
    const { container } = render(<SessionsView api={api} />);
    await userEvent.click(await screen.findByText('Refactor auth'));
    // R03 п.1: inert rendering is verified on the immediate conversation.
    await screen.findByText(/onerror/);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/alert\(1\)/)).toBeTruthy();
  });

  it('shows partial-trailing and parse diagnostics honestly', async () => {
    const { api } = makeApi({
      listProjects: { projects: [PROJECT], diagnostics: [] },
      listSessions: { sessions: [SESSION], diagnostics: [] },
      readSession: () => ({ ...readResult([], null, false), partialTrailing: true, diagnostics: [{ line: 7, error: 'invalid json' }] }),
    });
    render(<SessionsView api={api} />);
    await userEvent.click(await screen.findByText('Refactor auth'));
    // R03 п.1: honest notices surface on the immediate conversation view.
    await screen.findByText(/дописывается/i);
    expect(screen.getByText(/invalid json/)).toBeTruthy();
  });
});

describe('SafeMarkdown', () => {
  it('renders fenced code and paragraphs without touching raw HTML', () => {
    const { container } = render(<SafeMarkdown text={'Intro **bold**\n\n```\nconst a = 1;\n```\n<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('pre code')).toHaveTextContent('const a = 1;');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('**bold**'); // markdown stays literal text
  });

  it('never creates elements or handlers from injected markdown', () => {
    const { container } = render(<SafeMarkdown text={'[click](javascript:alert(1))\n\n<iframe src="evil"></iframe>'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('javascript:alert(1)');
  });
});
