/**
 * RED gate T8b — ChatPane: explicit write boundary (no auto-open), streaming
 * text, interrupt, error/recovery states from real bridge policies.
 */
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/renderer/ChatPane';
import { useChat } from '../../src/renderer/useChat';
import type { DesktopApi } from '../../src/renderer/api';
import type { ChatEventT } from '../../src/shared/m1Protocol';
import type { RendererSnapshot } from '../../src/renderer/types';

interface ChatRoute {
  openSession?: unknown;
  sendPrompt?: unknown;
  interrupt?: unknown;
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

describe('ChatPane — write boundary and lifecycle', () => {
  it('never opens the session automatically — only an explicit click starts chat', async () => {
    const { api, request } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await screen.findByRole('button', { name: /открыть чат/i });
    expect(request.mock.calls.map((c) => c[0])).not.toContain('openSession');
  });

  it('opens on click, accepts a prompt, and finalizes the streamed reply from message_end', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));

    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'hello pi');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
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
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'long job');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    const stop = await screen.findByRole('button', { name: /прервать/i });
    await userEvent.click(stop);
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'interrupt')).toBe(true));
    emit({ kind: 'pi', name: 'agent_settled', data: { aborted: true } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /прервать/i })).toBeNull());
  });

  it('surfaces SESSION_CONFLICT from openSession with a retry action (no spinner dead-end)', async () => {
    const { api } = makeApi({
      errors: {
        openSession: Object.assign(new Error('Session was modified within the active window'), {
          code: 'SESSION_CONFLICT',
        }),
      },
    });
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('SESSION_CONFLICT');
    expect(screen.getByRole('button', { name: /повторить/i })).toBeTruthy();
    expect(screen.queryByTestId('spinner')).toBeNull();
  });

  it('maps RESOURCE_BUSY (second open) to a visible busy message', async () => {
    const { api } = makeApi({
      errors: {
        openSession: new Error('RESOURCE_BUSY: A chat session is already open — close it before opening another'),
      },
    });
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('RESOURCE_BUSY');
  });

  it('renders tool lifecycle events as visible status lines', async () => {
    const { api, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    emit({ kind: 'pi', name: 'tool_execution_start', data: { toolCallId: 'c1', toolName: 'bash', args: {} } });
    await screen.findByText(/bash/);
    emit({ kind: 'pi', name: 'tool_execution_end', data: { toolCallId: 'c1', toolName: 'bash', isError: false, result: {} } });
    await waitFor(() => expect(screen.getByTestId('tools').textContent).toMatch(/✓/));
  });

  it('a closed(DISCONNECTED) event drops the pane into an explicit recovery state', async () => {
    const { api, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await screen.findByPlaceholderText(/сообщение/i);
    emit({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('DISCONNECTED');
    expect(screen.getByRole('button', { name: /открыть чат/i })).toBeTruthy(); // explicit reopen
  });
});
