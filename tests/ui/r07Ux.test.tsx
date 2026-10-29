/**
 * UI21 R07 — owner UX correction (Issue #21 #6442214523).
 *
 * Contract under test:
 * 1. exactly ONE right-panel toggle, in the center chat header, carrying the
 *    appearance of the former Details header collapse button; no second
 *    `close-details` button inside the panel;
 * 2. no "История | Чат" segmented switcher — one conversation screen where
 *    stored Pi messages and live turns share a single transcript;
 * 3. connection state lives only in the bottom status bar — not in the
 *    expanded sidebar, not in the collapsed rail;
 * 4. left-panel toggle is visually distinct from the right-panel toggle;
 * 5. terminal placeholder text is not clipped.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const FILE = '/home/u/.pi/agent/sessions/--p--/s1.jsonl';

/** Stable payloads: the real bridge returns cached objects per snapshot, so the
 *  sidebar must not see a brand-new array on every render. */
const PROJECTS = {
  projects: [{ id: 'p', path: '/tmp/p', sessionCount: 1, lastActivityAt: '2026-01-01T00:00:00.000Z' }],
  diagnostics: [] as string[],
};
const SESSIONS = {
  sessions: [
    {
      id: 's1',
      file: FILE,
      root: '/home/u/.pi/agent/sessions',
      projectId: 'p',
      projectPath: '/tmp/p',
      name: 's1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sizeBytes: 120,
      version: 3,
      availability: 'ok' as const,
      activeWrite: false,
      diagnostics: null,
    },
  ],
  diagnostics: [] as string[],
};
const PAGE = {
  entries: [
    { id: 'h1', type: 'message', raw: { type: 'message', message: { role: 'user', content: 'сохранённый вопрос' } } },
    { id: 'h2', type: 'message', raw: { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'сохранённый ответ' }] } } },
  ],
  diagnostics: [] as string[],
  truncated: false,
  partialTrailing: false,
  nextCursor: null,
};

/** API double with one project/session and a stored two-message history. */
function makeSessionApi() {
  const api = makeApi();
  const chatSubs: Array<(p: unknown) => void> = [];
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'listProjects') return PROJECTS;
    if (method === 'listSessions') return SESSIONS;
    if (method === 'readSession') return PAGE;
    if (method === 'openSession' || method === 'attachSession')
      return { state: { model: null, thinkingLevel: null, session: params?.file ?? FILE } };
    if (method === 'getAvailableModels') return { models: [] };
    if (method === 'getThinkingLevels') return { levels: [] };
    return { ok: true };
  });
  const onChatEvent = vi.fn((cb: (p: unknown) => void) => {
    chatSubs.push(cb);
    return () => chatSubs.splice(chatSubs.indexOf(cb), 1);
  });
  return {
    api: { ...api, request, onChatEvent } as typeof api,
    request,
    // UI26 R03: bridge штампует КАЖДОЕ событие ключом своего RPC-соединения.
    emit: (payload: unknown) => chatSubs.forEach((cb) => cb({ key: `file:${FILE}`, ...(payload as object) })),
  };
}

async function openSession(user: ReturnType<typeof userEvent.setup>) {
  // Search widens the tree (the same path a user takes to find one session).
  const search = await screen.findByLabelText(/поиск чатов/i);
  await user.type(search, 's1');
  const session = await screen.findByTestId('session-s1');
  await user.click(session);
  await screen.findByTestId('session-detail');
}

describe('R07 §1 — single right-panel toggle in the chat header', () => {
  it('keeps exactly one toggle, and the details header no longer carries a collapse button', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.getAllByTestId('open-details')).toHaveLength(1);
    await user.click(screen.getByTestId('open-details'));
    expect(screen.getByTestId('right-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('close-details')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('open-details')).toHaveLength(1);
  });

  it('reflects open/closed state and returns focus when closing from the header', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const toggle = screen.getByTestId('open-details');
    expect(toggle).toHaveAttribute('aria-label', 'Показать детали');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-label', 'Скрыть детали');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-details')).toHaveFocus();
  });

  it('exposes the preserved keyboard toggle on the header chip', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const toggle = screen.getByTestId('open-details');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('right-sidebar')).toBeInTheDocument();
  });
});

describe('R07 §2 — one conversation screen, no История/Чат switcher', () => {
  it('renders no interactive history/chat tabs at all', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.queryByTestId('tab-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: /режим сессии/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /история/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^чат$/i })).not.toBeInTheDocument();
  });

  it('shows stored Pi messages and live turns in ONE transcript, without duplicates', async () => {
    const user = userEvent.setup();
    const { api, emit, request } = makeSessionApi();
    render(<App api={api} moduleDefinitions={[]} />);
    await openSession(user);
    const pane = await screen.findByTestId('chat-pane');
    await waitFor(() => expect(within(pane).getByText('сохранённый вопрос')).toBeInTheDocument());
    expect(within(pane).getByText('сохранённый ответ')).toBeInTheDocument();

    await user.click(within(pane).getByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));

    emit({
      kind: 'event',
      name: 'message_end',
      data: { message: { role: 'user', content: 'новый вопрос' } },
    });
    emit({
      kind: 'event',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: 'новый ответ' }] } },
    });
    await waitFor(() => expect(within(pane).getByText('новый ответ')).toBeInTheDocument());

    // one chronological list: stored first, live after, nothing replayed twice
    const texts = [
      'сохранённый вопрос',
      'сохранённый ответ',
      'новый вопрос',
      'новый ответ',
    ];
    for (const t of texts) expect(within(pane).getAllByText(t)).toHaveLength(1);
    // the transcript is read once — a live turn never re-reads the JSONL
    expect(request.mock.calls.filter((c) => c[0] === 'readSession')).toHaveLength(1);
  });
});

describe('R07 §3 — connection state only in the bottom status bar', () => {
  it('removes the duplicate connection label from the expanded sidebar', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const side = screen.getByTestId('left-sidebar');
    expect(within(side).queryByText(/Pi подключён/i)).not.toBeInTheDocument();
    expect(within(side).queryByTestId('sidebar-connection')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('status-connection')).toHaveTextContent(/Pi подключён/i));
  });

  it('removes it from the collapsed rail too', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('sidebar-collapse'));
    const rail = screen.getByTestId('left-sidebar');
    expect(rail).toHaveAttribute('data-collapsed');
    expect(within(rail).queryByText(/Pi подключён/i)).not.toBeInTheDocument();
    expect(within(rail).queryByLabelText(/Pi подключён/i)).not.toBeInTheDocument();
    expect(within(rail).queryByTestId('sidebar-connection')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('status-connection')).toHaveTextContent(/Pi подключён/i));
  });
});

describe('R07 §4 — the two panel toggles are visually distinguishable', () => {
  it('uses different glyphs for the left and right toggles', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const left = screen.getByTestId('sidebar-collapse');
    const right = screen.getByTestId('open-details');
    const leftPath = left.querySelector('svg')?.innerHTML ?? '';
    const rightPath = right.querySelector('svg')?.innerHTML ?? '';
    expect(leftPath).not.toBe('');
    expect(rightPath).not.toBe('');
    expect(leftPath).not.toBe(rightPath);
    expect(left.className).not.toBe(right.className);
  });
});

describe('R07 §5 — terminal placeholder is not clipped', () => {
  it('lets the terminal note wrap instead of being cut at narrow widths', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/design/components.css'), 'utf8');
    const block = css.split('.dl-term-note').slice(1).join('');
    const rule = block.slice(0, block.indexOf('}'));
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
    expect(rule).toMatch(/text-overflow|min-width/);
  });
});
