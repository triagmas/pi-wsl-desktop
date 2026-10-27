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

/**
 * UI21-F1-A #4 (fixture-backed, SIMULATED events only — never a real model
 * call): resumed session, reconnect and a single final message.
 */
describe('UI21-F1-A: resume / reconnect / single final message (simulated events)', () => {
  it('keeps exactly one final message across close → resume (simulated stream)', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.filter((c) => c[0] === 'openSession')).toHaveLength(1));

    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'hello pi');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    emit({ kind: 'pi', name: 'message_update', data: { assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello 🌍' } } });
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Hello 🌍 — final answer' }], stopReason: 'stop', timestamp: 2 } },
    });
    emit({ kind: 'pi', name: 'agent_settled', data: { aborted: false } });
    await waitFor(() => expect(screen.getAllByText('Hello 🌍 — final answer')).toHaveLength(1));
    expect(await screen.findByTestId('chat-status')).toHaveTextContent('Чат открыт');

    // resume: close the chat explicitly, then open it again
    await userEvent.click(screen.getByRole('button', { name: /закрыть чат/i }));
    await screen.findByRole('button', { name: /открыть чат/i });
    await userEvent.click(screen.getByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.filter((c) => c[0] === 'openSession')).toHaveLength(2));

    // conversation survives the resume — and the final message is rendered ONCE
    expect(screen.getAllByText('Hello 🌍 — final answer')).toHaveLength(1);
    expect(await screen.findByTestId('chat-status')).toHaveTextContent('Чат открыт');
    expect(screen.queryByTestId('chat-banner')).toBeNull();
    expect(screen.queryByTestId('chat-error')).toBeNull();
  });

  it('reconnect after DISCONNECTED drops stale live tool steps and reopens cleanly (simulated)', async () => {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'job');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));

    // mid-run disconnect: the RPC process died while a tool step was active
    emit({ kind: 'pi', name: 'tool_execution_start', data: { toolCallId: 'c1', toolName: 'bash', args: {} } });
    emit({ kind: 'closed', code: 'DISCONNECTED', message: 'Pi RPC process exited' });
    const banner = await screen.findByTestId('chat-banner');
    expect(banner).toHaveTextContent('DISCONNECTED');

    // explicit reopen after the drop
    await userEvent.click(screen.getByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.filter((c) => c[0] === 'openSession')).toHaveLength(2));
    expect(await screen.findByTestId('chat-status')).toHaveTextContent('Чат открыт');
    expect(screen.queryByTestId('chat-banner')).toBeNull();

    // no phantom live run: the dead run's tool steps must not come back
    expect(screen.queryByTestId('tools')).toBeNull();
    expect(screen.queryByText(/bash\s*⏳/)).toBeNull();
  });
});

describe('UI21-F1-C: failed generation shows a visible error (no blank bubble)', () => {
  async function openChat() {
    const { api, request, emit } = makeApi();
    render(<ChatHarness api={api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    return { emit };
  }

  it('assistant stopReason=error renders an alert with the actual error message, not a blank bubble', async () => {
    const { emit } = await openChat();
    emit({
      kind: 'pi',
      name: 'message_end',
      data: {
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: "Cannot read properties of undefined (reading 'length')",
          timestamp: 2,
        },
      },
    });
    const alert = await screen.findByTestId('chat-message-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toContain("Cannot read properties of undefined (reading 'length')");
    expect((alert.textContent ?? '').trim()).not.toBe('');
  });

  it('error text is bounded and redacted: raw api keys and filesystem paths never reach the DOM', async () => {
    const { emit } = await openChat();
    emit({
      kind: 'pi',
      name: 'message_end',
      data: {
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'Request failed: sk-abcdef1234567890ABCDEF at /home/triag/.pi/agent/auth.json retry=3',
          timestamp: 2,
        },
      },
    });
    const alert = await screen.findByTestId('chat-message-error');
    const visible = alert.textContent ?? '';
    expect(visible).not.toContain('sk-abcdef1234567890ABCDEF');
    expect(visible).not.toContain('/home/triag/.pi');
    expect(visible.length).toBeLessThan(600);
  });

  it('redacts GitHub PAT prefixes (ghp_/github_pat_), Bearer credentials and C:/ paths', async () => {
    const { emit } = await openChat();
    const rawError =
      'push failed: ghp_16C7e42F292c6912E7710c838347Ae178B4a and github_pat_11ABCDEFG0123456789_abcdefghijklmnop ' +
      'Authorization: Bearer dummyBearerToken1234567890 file C:/Users/triag/AppData/Local/secret.txt';
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: rawError, timestamp: 2 } },
    });
    const visible = (await screen.findByTestId('chat-message-error')).textContent ?? '';
    // no fragment of any credential survives — neither prefix nor suffix
    for (const leak of ['ghp_', '16C7e42F', 'github_pat_', '11ABCDEFG', 'dummyBearer', 'Bearer dummy', 'C:/Users', 'AppData']) {
      expect(visible).not.toContain(leak);
    }
    expect(visible).toContain('[redacted]');
    expect(visible).toContain('[path]');
  });

  it('normal assistant finalization keeps rendering text with no error box', async () => {
    const { emit } = await openChat();
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }], stopReason: 'stop', timestamp: 2 } },
    });
    await screen.findByText('final answer');
    expect(screen.queryByTestId('chat-message-error')).toBeNull();
  });

  it('an aborted empty reply does not fabricate an error box', async () => {
    const { emit } = await openChat();
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [], stopReason: 'aborted', timestamp: 2 } },
    });
    await waitFor(() => expect(screen.queryByTestId('chat-message-error')).toBeNull());
  });
});
