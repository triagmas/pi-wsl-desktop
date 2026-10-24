/**
 * RED gate T8b — ChatPane: explicit write boundary (no auto-open), streaming
 * text, interrupt, error/recovery states from real bridge policies.
 */
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/renderer/ChatPane';
import { SessionDetail } from '../../src/renderer/SessionDetail';
import { useChat } from '../../src/renderer/useChat';
import type { DesktopApi } from '../../src/renderer/api';
import type { ChatEventT } from '../../src/shared/m1Protocol';
import type { RendererSnapshot, SessionInfoT } from '../../src/renderer/types';

interface ChatRoute {
  openSession?: unknown;
  sendPrompt?: unknown;
  interrupt?: unknown;
  readSession?: unknown;
  errors?: Record<string, unknown>;
}

function makeApi(route: ChatRoute = {}) {
  const chatSubs: Array<(p: unknown) => void> = [];
  const request = vi.fn(async (method: string) => {
    if (route.errors && method in route.errors) throw route.errors[method];
    switch (method) {
      case 'openSession':
        return route.openSession ?? { state: { sessionId: 's1', sessionFile: '/f.jsonl', isStreaming: false, isCompacting: false, messageCount: 0, model: null, thinkingLevel: 'medium' } };
      case 'sendPrompt':
        return route.sendPrompt ?? { disposition: 'started' };
      case 'interrupt':
        return route.interrupt ?? { interrupted: true };
      case 'readSession':
        return route.readSession ?? {
          header: { type: 'session', version: 3, id: 'x', timestamp: 'T', cwd: '/work/repo' },
          entries: [],
          leafId: null,
          nextCursor: null,
          truncated: false,
          partialTrailing: false,
          diagnostics: [],
          availability: 'ok',
        };
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

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };

const FILE = '/root/--work-repo--/s1.jsonl';

/**
 * Behavior-preserving migration (§9.1 item 4): the chat controller and composer
 * draft now live ABOVE unmountable panels. The harness reproduces the app-level
 * wiring so every boundary/streaming assertion below stays exactly as it was.
 */
function ChatHarness({ api, file }: { api: DesktopApi; file: string }) {
  const chat = useChat(api, file);
  const [draft, setDraft] = useState('');
  return <ChatPane chat={chat} draft={draft} onDraftChange={setDraft} />;
}

/** R03 п.1: the app-level surface — SessionDetail owns the history feed and
 * feeds it into the conversation + composer in one scroll. */
function DetailHarness({ api, file }: { api: DesktopApi; file: string }) {
  const chat = useChat(api, file);
  const [draft, setDraft] = useState('');
  const session: SessionInfoT = {
    id: 's1',
    file,
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
  return <SessionDetail api={api} session={session} chat={chat} draft={draft} onDraftChange={setDraft} />;
}

describe('ChatPane — write boundary and lifecycle', () => {
  it('the composer is usable at once; only an explicit SEND opens the session (no auto-open)', async () => {
    const { api, request } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    // R03 п.1: no tab strip and no «open the chat» invitation in the
    // workspace — the composer is live from the first render …
    const input = await screen.findByPlaceholderText(/сообщение/i);
    expect(input).toBeEnabled();
    expect(screen.queryByTestId('open-chat')).toBeNull();
    expect(screen.queryByTestId('tab-chat')).toBeNull();
    expect(screen.queryByText(/официальный Pi RPC/i)).toBeNull();
    expect(request.mock.calls.map((c) => c[0])).not.toContain('openSession');
    // … and the explicit send IS the explicit open action (Issue #5 gate 5:
    // «session starts only on explicit click or send»): open before prompt.
    await userEvent.type(input, 'hello pi');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => {
      const methods = request.mock.calls.map((c) => c[0]);
      const openAt = methods.indexOf('openSession');
      expect(openAt).toBeGreaterThanOrEqual(0);
      expect(methods.indexOf('sendPrompt')).toBeGreaterThan(openAt);
    });
  });

  it('shows the conversation + composer immediately, without the История/Чат tabs (R03 п.1)', async () => {
    const { api, request } = makeApi({
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
    render(<DetailHarness api={api} file={FILE} />);
    await screen.findByText('stored line');
    expect(screen.queryByTestId('tab-history')).toBeNull();
    expect(screen.queryByTestId('tab-chat')).toBeNull();
    expect(screen.getByTestId('chat-composer')).toBeEnabled();
    // read-only history must not open a write session
    expect(request.mock.calls.map((c) => c[0])).not.toContain('openSession');
  });

  it('never submits during IME composition; plain Enter still sends (R02 A3)', async () => {
    const { api, request } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'перевод');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(request.mock.calls.map((c) => c[0])).not.toContain('openSession');
    expect(request.mock.calls.map((c) => c[0])).not.toContain('sendPrompt');
    // control: the same Enter outside composition opens then prompts
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'sendPrompt')).toBe(true));
  });

  it('an explicit send opens the session and finalizes the streamed reply from message_end', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    // R03 п.1: no open-button — the send itself opens the session first.
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'hello pi');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'sendPrompt')).toBe(true));

    // live streaming deltas render while sending
    emit({ kind: 'pi', name: 'message_update', data: { assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello 🌍' } } });
    await screen.findByText('Hello 🌍');

    // authoritative completion replaces the buffer
    emit({
      kind: 'pi',
      name: 'message_end',
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello 🌍 — final answer' }],
          stopReason: 'stop',
          timestamp: 2,
        },
      },
    });
    await screen.findByText('Hello 🌍 — final answer');
    emit({ kind: 'pi', name: 'agent_settled', data: { aborted: false } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /прервать/i })).toBeNull());
  });

  it('shows the interrupt button while sending and calls interrupt on click', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'long job');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    const stop = await screen.findByRole('button', { name: /прервать/i });
    await userEvent.click(stop);
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'interrupt')).toBe(true));
    emit({ kind: 'pi', name: 'agent_settled', data: { aborted: true } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /прервать/i })).toBeNull());
  });

  it('surfaces SESSION_CONFLICT from the send-driven open with a retry action (no spinner dead-end)', async () => {
    const { api } = makeApi({
      errors: {
        openSession: Object.assign(new Error('Session was modified within the active window'), {
          code: 'SESSION_CONFLICT',
        }),
      },
    });
    render(<ChatHarness api={api} file={FILE} />);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'conflict me');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('SESSION_CONFLICT');
    expect(screen.getByRole('button', { name: /повторить/i })).toBeTruthy();
    expect(screen.queryByTestId('spinner')).toBeNull();
    // the draft is preserved for the retry
    expect(input).toHaveValue('conflict me');
  });

  it('maps RESOURCE_BUSY (second open attempt) to a visible busy message', async () => {
    const { api } = makeApi({
      errors: {
        openSession: new Error('RESOURCE_BUSY: A chat session is already open — close it before opening another'),
      },
    });
    render(<ChatHarness api={api} file={FILE} />);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'busy me');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('RESOURCE_BUSY');
  });

  it('renders tool lifecycle events as visible status lines', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'run tools');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    emit({ kind: 'pi', name: 'tool_execution_start', data: { toolCallId: 'c1', toolName: 'bash', args: {} } });
    await screen.findByText(/bash/);
    emit({ kind: 'pi', name: 'tool_execution_end', data: { toolCallId: 'c1', toolName: 'bash', isError: false, result: {} } });
    // R02: one icon family — completion is a done-state icon, not a glyph.
    await waitFor(() =>
      expect(document.querySelector('[data-testid="tools"] .tool-state-done')).toBeTruthy(),
    );
  });

  it('a closed(DISCONNECTED) event drops the pane into an explicit recovery state', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'first try');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    emit({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('DISCONNECTED');
    // R03 п.1: no reopen button — the composer stays usable and the next
    // explicit send re-opens the session (concise banner, no lecture copy).
    expect(input).toBeEnabled();
    expect(alert).not.toHaveTextContent(/Откройте чат заново/i);
    await userEvent.type(input, ' again');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() =>
      expect(request.mock.calls.filter((c) => c[0] === 'openSession').length).toBe(2),
    );
  });
});
