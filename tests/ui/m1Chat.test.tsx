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
  models?: unknown;
  thinking?: unknown;
  setModel?: unknown;
  setThinkingLevel?: unknown;
}

function makeApi(route: ChatRoute = {}) {
  const chatSubs: Array<(p: unknown) => void> = [];
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (route.errors && method in route.errors) throw route.errors[method];
    switch (method) {
      case 'openSession':
        return (
          route.openSession ?? {
            state: {
              sessionId: 's1',
              sessionFile: '/f.jsonl',
              isStreaming: false,
              isCompacting: false,
              messageCount: 0,
              model: { id: 'model-one', name: 'Model One', provider: 'prov-a' },
              thinkingLevel: 'off',
            },
          }
        );
      // UI21-F2: catalog + thinking come from Pi, never from the app.
      case 'getAvailableModels':
        return route.models ?? { models: [
          { provider: 'prov-a', id: 'model-one', name: 'Model One' },
          { provider: 'prov-b', id: 'model-two', name: 'Model Two' },
        ] };
      case 'getThinkingLevels':
        return route.thinking ?? { levels: ['off', 'high'], current: 'off' };
      case 'setModel': {
        if (route.setModel) return route.setModel;
        const p = params as { provider: string; modelId: string };
        return { state: { sessionId: 's1', sessionFile: '/f.jsonl', isStreaming: false, isCompacting: false, messageCount: 0,
          model: { id: p.modelId, name: p.modelId === 'model-two' ? 'Model Two' : 'Model One', provider: p.provider }, thinkingLevel: 'off' } };
      }
      case 'setThinkingLevel': {
        if (route.setThinkingLevel) return route.setThinkingLevel;
        const p = params as { level: string };
        return { state: { sessionId: 's1', sessionFile: '/f.jsonl', isStreaming: false, isCompacting: false, messageCount: 0,
          model: { id: 'model-one', name: 'Model One', provider: 'prov-a' }, thinkingLevel: p.level } };
      }
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

describe('UI21-F2: model & thinking selectors read through to Pi', () => {
  async function openChat(route: ChatRoute = {}) {
    const api = makeApi(route);
    render(<ChatHarness api={api.api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(api.request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    return api;
  }

  it('shows the ACTIVE model from Pi state and fetches the catalog from Pi', async () => {
    const api = await openChat();
    // active model chip reflects get_state, not a hard-coded label
    expect(await screen.findByTestId('model-selector')).toHaveTextContent('prov-a/model-one');
    await waitFor(() => expect(api.request.mock.calls.some((c) => c[0] === 'getAvailableModels')).toBe(true));
    await waitFor(() => expect(api.request.mock.calls.some((c) => c[0] === 'getThinkingLevels')).toBe(true));
  });

  it('lists every Pi model, and selecting one calls setModel + follows the fresh state', async () => {
    const api = await openChat();
    await userEvent.click(await screen.findByTestId('model-selector'));
    const items = await screen.findAllByTestId(/^model-option-/);
    expect(items.map((el) => el.textContent)).toEqual([
      expect.stringContaining('prov-a'),
      expect.stringContaining('prov-b'),
    ]);
    await userEvent.click(screen.getByTestId('model-option-prov-b:model-two'));
    await waitFor(() =>
      expect(api.request.mock.calls.some((c) => c[0] === 'setModel' && (c[1] as { modelId?: string })?.modelId === 'model-two')).toBe(true),
    );
    expect(await screen.findByTestId('model-selector')).toHaveTextContent('prov-b/model-two');
  });

  it('thinking levels come from Pi for the selected model; selection applies via setThinkingLevel', async () => {
    const api = await openChat();
    const chip = await screen.findByTestId('thinking-selector');
    expect(chip).toHaveTextContent('off');
    await userEvent.click(chip);
    expect((await screen.findAllByTestId(/^thinking-option-/)).map((e) => e.textContent)).toEqual(['off', 'high']);
    await userEvent.click(screen.getByTestId('thinking-option-high'));
    await waitFor(() =>
      expect(api.request.mock.calls.some((c) => c[0] === 'setThinkingLevel' && (c[1] as { level?: string })?.level === 'high')).toBe(true),
    );
    expect(await screen.findByTestId('thinking-selector')).toHaveTextContent('high');
  });

  it('a single-level model disables the thinking selector instead of inventing levels', async () => {
    await openChat({ thinking: { levels: ['off'], current: 'off' } });
    const chip = await screen.findByTestId('thinking-selector');
    expect(chip).toBeDisabled();
  });

  it('an empty Pi catalog is shown honestly — no fabricated default model', async () => {
    const api = await openChat({ models: { models: [] } });
    await userEvent.click(await screen.findByTestId('model-selector'));
    expect(await screen.findByTestId('model-menu-empty')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^model-option-/)).toHaveLength(0);
    expect(api.request.mock.calls.some((c) => c[0] === 'setModel')).toBe(false);
  });

  it('selectors are disabled while a run is streaming (no silent mid-run switch)', async () => {
    const api = await openChat();
    const input = await screen.findByPlaceholderText(/сообщение/i);
    await userEvent.type(input, 'hello');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(screen.getByTestId('thinking-selector')).toBeDisabled());
    expect(screen.getByTestId('model-selector')).toBeDisabled();
    expect(api.request.mock.calls.some((c) => c[0] === 'setModel')).toBe(false);
  });

  it('a failed switch surfaces a readable error and keeps the previous model', async () => {
    await openChat({ errors: { setModel: new Error('INVALID_REQUEST: Model not found') } });
    await userEvent.click(await screen.findByTestId('model-selector'));
    await userEvent.click(await screen.findByTestId('model-option-prov-b:model-two'));
    const err = await screen.findByTestId('chat-error');
    expect(err).toHaveTextContent('INVALID_REQUEST');
    expect(screen.getByTestId('model-selector')).toHaveTextContent('prov-a/model-one');
  });
});

describe('UI21-F2 r01: catalog availability and independent error handling', () => {
  async function openChat(route: ChatRoute = {}) {
    const api = makeApi(route);
    render(<ChatHarness api={api.api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(api.request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    return api;
  }

  // P1: no active model yet (get_state.model === null) and an empty catalog must
  // still expose a usable selector + menu + explicit refresh.
  it('P1: with no active model and an empty catalog the selector is still reachable', async () => {
    const api = await openChat({
      openSession: { state: { sessionId: 's1', sessionFile: '/f.jsonl', isStreaming: false, isCompacting: false, messageCount: 0, model: null, thinkingLevel: null } },
      models: { models: [] },
      thinking: { levels: [], current: null },
    });
    const chip = await screen.findByTestId('model-selector');
    expect(chip).toHaveTextContent(/модел/i);
    await userEvent.click(chip);
    expect(await screen.findByTestId('model-menu-empty')).toBeInTheDocument();
    expect(screen.getByTestId('model-menu-refresh')).toBeInTheDocument();
    // refresh re-reads Pi and fills the list without inventing anything
    await userEvent.click(screen.getByTestId('model-menu-refresh'));
    await waitFor(() => expect(api.request.mock.calls.filter((c) => c[0] === 'getAvailableModels').length).toBeGreaterThan(1));
  });

  it('P1: refresh after Pi starts reporting a model makes it selectable', async () => {
    let call = 0;
    const api = makeApi({
      openSession: { state: { sessionId: 's1', sessionFile: '/f.jsonl', isStreaming: false, isCompacting: false, messageCount: 0, model: null, thinkingLevel: null } },
      models: { models: [] },
      thinking: { levels: [], current: null },
    });
    // second catalog read returns a real model (Pi config appeared)
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'getAvailableModels') {
        call += 1;
        if (call > 1) return { models: [{ provider: 'prov-a', id: 'model-one', name: 'Model One' }] };
      }
      return original(method, params);
    });
    render(<ChatHarness api={api.api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await userEvent.click(await screen.findByTestId('model-selector'));
    expect(await screen.findByTestId('model-menu-empty')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('model-menu-refresh'));
    const option = await screen.findByTestId('model-option-prov-a:model-one');
    await userEvent.click(option);
    await waitFor(() => expect(api.request.mock.calls.some((c) => c[0] === 'setModel')).toBe(true));
  });

  // P2: a thinking-level failure must not wipe a valid model catalog.
  it('P2: thinking failure keeps the Pi model catalog and reports the levels error', async () => {
    await openChat({
      errors: { getThinkingLevels: new Error('BRIDGE_TIMEOUT: thinking levels timed out') },
    });
    await userEvent.click(await screen.findByTestId('model-selector'));
    // catalog survived the thinking failure
    expect(await screen.findByTestId('model-option-prov-a:model-one')).toBeInTheDocument();
    expect(screen.getByTestId('model-option-prov-b:model-two')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // the thinking selector reports its own failure instead of inventing levels
    await userEvent.click(screen.getByTestId('thinking-selector'));
    expect(await screen.findByTestId('thinking-menu-error')).toHaveTextContent(/BRIDGE_TIMEOUT/);
    expect(screen.queryAllByTestId(/^thinking-option-/)).toHaveLength(0);
  });
});

describe('UI21 R02: redaction boundary and tool-entry presentation', () => {
  async function openChat(route: ChatRoute = {}) {
    const api = makeApi(route);
    render(<ChatHarness api={api.api} file={FILE} />);
    await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(api.request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
    return api;
  }

  it('quoted JSON credentials never reach the DOM from a failed model message', async () => {
    const { emit } = await openChat();
    emit({
      kind: 'pi',
      name: 'message_end',
      data: {
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'provider said {"api_key":"syntheticSecret123"} and {"apiKey": "syntheticSecret456"}',
          timestamp: 2,
        },
      },
    });
    const visible = (await screen.findByTestId('chat-message-error')).textContent ?? '';
    expect(visible).not.toContain('syntheticSecret123');
    expect(visible).not.toContain('syntheticSecret456');
    expect(visible).toContain('[redacted]');
  });

  it('bridge command errors (state.error) are redacted too', async () => {
    await openChat({ errors: { setModel: new Error('INVALID_REQUEST: Authorization: Bearer syntheticCredential123') } });
    await userEvent.click(await screen.findByTestId('model-selector'));
    await userEvent.click(await screen.findByTestId('model-option-prov-b:model-two'));
    const err = await screen.findByTestId('chat-error');
    expect(err.textContent).not.toContain('syntheticCredential123');
    expect(err.textContent).toContain('INVALID_REQUEST');
  });

  it('catalog and thinking errors are redacted as well', async () => {
    await openChat({ errors: { getAvailableModels: new Error('DISCONNECTED: sk-syntheticSecret789') } });
    await userEvent.click(await screen.findByTestId('model-selector'));
    const empty = await screen.findByTestId('model-menu-empty');
    expect(empty.textContent).not.toContain('syntheticSecret789');
  });

  it('a disconnect banner is redacted', async () => {
    const { emit } = await openChat();
    emit({ kind: 'closed', code: 'DISCONNECTED', message: 'socket died with token ghp_syntheticSecret999' });
    const banner = await screen.findByTestId('chat-banner');
    expect(banner.textContent).not.toContain('syntheticSecret999');
  });

  it('restores a semantically separate representation for persisted tool entries', async () => {
    const { emit } = await openChat();
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'stdout: ok' }], timestamp: 2 } },
    });
    const tool = await screen.findByTestId('chat-tool-entry');
    expect(tool.className).toContain('bubble-tool');
    expect(tool.textContent).toContain('bash');
    expect(tool.textContent).toContain('stdout: ok');
    // assistant entries keep the ordinary path (no tool styling)
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }], stopReason: 'stop', timestamp: 3 } },
    });
    await screen.findByText('final answer');
    expect(screen.queryAllByTestId('chat-tool-entry')).toHaveLength(1);
  });
});
