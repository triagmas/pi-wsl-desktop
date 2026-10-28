/**
 * UI21 R07 r01 — remediation of the independent review on #6444985225.
 *
 * P1-A: every JSONL read error passes the SAME central redaction boundary that
 *       the rest of the UI uses — a secret in a bridge error can never reach
 *       the DOM.
 * P1-B: persisted history and live turns keep a truthful chronology, including
 *       forward pagination: while later persisted records are still unloaded the
 *       UI shows an explicit gap and a correctly-named "next" action instead of
 *       pretending the live turn follows the shown records.
 * P2-A: a session switch never renders the previous file's messages, not even
 *       for one frame while the new page is still loading.
 * P2-B: the explicit Pi RPC open gate is compact but still a deliberate action.
 */
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/renderer/ChatPane';
import { useChat } from '../../src/renderer/useChat';
import type { DesktopApi } from '../../src/renderer/api';
import type { ChatEventT } from '../../src/shared/m1Protocol';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };
const FILE_A = '/root/--p--/a.jsonl';
const FILE_B = '/root/--p--/b.jsonl';

type Page = { entries: unknown[]; nextCursor: string | null; truncated: boolean; partialTrailing?: boolean; diagnostics?: string[] };

interface Routes {
  /** file → pages; a page may be a promise to model a slow read. */
  pages?: Record<string, Array<Page | Promise<Page>>>;
  errors?: Record<string, unknown>;
}

function makeApi(routes: Routes = {}) {
  const chatSubs: Array<(p: unknown) => void> = [];
  const readCalls: Array<Record<string, unknown>> = [];
  const counter: Record<string, number> = {};
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (routes.errors && method in routes.errors) throw routes.errors[method];
    switch (method) {
      case 'readSession': {
        readCalls.push(params ?? {});
        const file = String(params?.file ?? '');
        const pages = routes.pages?.[file] ?? [];
        const idx = counter[file] ?? 0;
        counter[file] = idx + 1;
        const page = pages[Math.min(idx, pages.length - 1)];
        return page ?? { entries: [], nextCursor: null, truncated: false, partialTrailing: false, diagnostics: [] };
      }
      case 'openSession':
        return {
          state: {
            sessionId: 's1',
            sessionFile: FILE_A,
            isStreaming: false,
            isCompacting: false,
            messageCount: 0,
            model: { id: 'model-one', name: 'Model One', provider: 'prov-a' },
            thinkingLevel: 'off',
          },
        };
      case 'getAvailableModels':
        return { models: [{ provider: 'prov-a', id: 'model-one', name: 'Model One' }] };
      case 'getThinkingLevels':
        return { levels: ['off'], current: 'off' };
      case 'sendPrompt':
        return { disposition: 'started' };
      case 'closeSession':
        return { closed: true };
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
  return { api, request, readCalls, emit: (p: ChatEventT) => [...chatSubs].forEach((cb) => cb(p)) };
}

function Harness({ api, file }: { api: DesktopApi; file: string }) {
  const chat = useChat(api, file);
  const [draft, setDraft] = useState('');
  return <ChatPane api={api} file={file} chat={chat} draft={draft} onDraftChange={setDraft} />;
}

const msg = (id: string | null, role: 'user' | 'assistant', text: string) => ({
  id,
  type: 'message',
  raw: {
    type: 'message',
    message: { role, content: role === 'assistant' ? [{ type: 'text', text }] : text },
  },
});

const pageOf = (prefix: string, count: number, cursor: string | null, truncated: boolean): Page => ({
  entries: Array.from({ length: count }, (_, i) =>
    msg(`${prefix}${i}`, i % 2 === 0 ? 'user' : 'assistant', `${prefix} сообщение ${i}`),
  ),
  nextCursor: cursor,
  truncated,
  partialTrailing: false,
  diagnostics: [],
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* P1-A — redaction of JSONL read errors                              */
/* ------------------------------------------------------------------ */
describe('R07 r01 P1-A — JSONL read errors are redacted before the DOM', () => {
  const SECRETS = [
    'syntheticSecret123',
    'syntheticAccessToken999',
    'syntheticClientSecret42',
    'ghp_syntheticGithubTokenXYZ',
  ];

  it('never renders a credential coming from readSession, but keeps the actionable code', async () => {
    const { api } = makeApi({
      errors: {
        readSession: new Error(
          'READ_FAILED: {"api_key":"syntheticSecret123","accessToken":"syntheticAccessToken999",' +
            '"client_secret":"syntheticClientSecret42"} header=Bearer ghp_syntheticGithubTokenXYZ',
        ),
      },
    });
    render(<Harness api={api} file={FILE_A} />);

    const box = await screen.findByTestId('chat-history-error');
    expect(box).toHaveTextContent('READ_FAILED');
    const html = box.outerHTML;
    for (const secret of SECRETS) expect(html).not.toContain(secret);
    expect(html).toContain('[redacted]');
  });

  it('redacts a secret nested in a bridge error object, not only in plain Error text', async () => {
    const { api } = makeApi({
      errors: {
        readSession: Object.assign(new Error('read failed'), {
          code: 'SESSION_UNREADABLE',
          detail: 'client_secret: syntheticClientSecret42',
          message: 'read failed: password=syntheticSecret123',
        }),
      },
    });
    render(<Harness api={api} file={FILE_A} />);
    const box = await screen.findByTestId('chat-history-error');
    expect(box).toHaveTextContent('SESSION_UNREADABLE');
    expect(box.outerHTML).not.toContain('syntheticClientSecret42');
    expect(box.outerHTML).not.toContain('syntheticSecret123');
  });
});

/* ------------------------------------------------------------------ */
/* P1-B — chronology with forward pagination                          */
/* ------------------------------------------------------------------ */
describe('R07 r01 P1-B — persisted/live chronology and forward pagination', () => {
  it('marks the gap while later persisted records are unloaded and names the action forward', async () => {
    const user = userEvent.setup();
    const first = pageOf('p1-', 100, 'cursor-1', true);
    const second = pageOf('p2-', 3, null, false);
    const { api, readCalls, emit } = makeApi({ pages: { [FILE_A]: [first, second] } });
    render(<Harness api={api} file={FILE_A} />);

    await waitFor(() => expect(screen.getByText('p1- сообщение 1')).toBeInTheDocument());
    const gap = await screen.findByTestId('chat-history-gap');
    expect(gap).toBeInTheDocument();
    // forward direction, never "earlier"
    expect(gap.textContent ?? '').toMatch(/следующ/i);
    expect(gap.textContent ?? '').not.toMatch(/более ранн/i);

    emit({ kind: 'pi', name: 'message_end', data: { message: { role: 'user', content: 'живой вопрос' } } });
    await screen.findByText('живой вопрос');

    // The live turn must not be presented as directly continuing page 1.
    const gapEl = screen.getByTestId('chat-history-gap');
    const live = screen.getByText('живой вопрос');
    expect(gapEl.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(within(gap).getByTestId('chat-history-more'));
    expect(readCalls.at(-1)).toMatchObject({ file: FILE_A, sinceEntryId: 'cursor-1' });
    await waitFor(() => expect(screen.getByText('p2- сообщение 2')).toBeInTheDocument());
    // page 2 sits between page 1 and the live turn, and the gap is gone
    expect(screen.queryByTestId('chat-history-gap')).not.toBeInTheDocument();
    const p2 = screen.getByText('p2- сообщение 2');
    expect(p2.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps React keys unique when paged entries carry no id', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const p1: Page = {
      entries: Array.from({ length: 2 }, (_, i) => msg(null, i ? 'assistant' : 'user', `без-id ${i}`)),
      nextCursor: 'c1',
      truncated: true,
    };
    const p2: Page = {
      entries: Array.from({ length: 2 }, (_, i) => msg(null, i ? 'assistant' : 'user', `страница2 ${i}`)),
      nextCursor: null,
      truncated: false,
    };
    const { api } = makeApi({ pages: { [FILE_A]: [p1, p2] } });
    render(<Harness api={api} file={FILE_A} />);

    await waitFor(() => expect(screen.getByText('без-id 1')).toBeInTheDocument());
    await user.click(screen.getByTestId('chat-history-more'));
    await waitFor(() => expect(screen.getByText('страница2 1')).toBeInTheDocument());
    const dupes = errors.mock.calls.filter((c) => String(c[0]).includes('same key'));
    expect(dupes).toEqual([]);
  });

  it('keeps a second, genuinely new pair even when its text equals the stored one', async () => {
    // UI21 R07 r02 (#6446392236): a user may ask the same thing twice.
    const { api, emit } = makeApi({
      pages: { [FILE_A]: [{ entries: [msg('h1', 'user', 'Привет'), msg('h2', 'assistant', 'Готово')], nextCursor: null, truncated: false }] },
    });
    render(<Harness api={api} file={FILE_A} />);
    await waitFor(() => expect(screen.getByText('Готово')).toBeInTheDocument());

    // Two distinct live events with identical text — both must stay visible.
    emit({ kind: 'pi', name: 'message_end', data: { message: { role: 'user', content: 'Привет' } } });
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Готово' }] } },
    });
    await waitFor(() => expect(screen.getAllByText('Готово')).toHaveLength(2));
    expect(screen.getAllByText('Привет')).toHaveLength(2);
  });

  it('deduplicates only a provably identical event (same persisted message id)', async () => {
    const { api, emit } = makeApi({
      pages: { [FILE_A]: [{ entries: [msg('h1', 'user', 'вопрос'), msg('h2', 'assistant', 'ответ')], nextCursor: null, truncated: false }] },
    });
    render(<Harness api={api} file={FILE_A} />);
    await waitFor(() => expect(screen.getByText('ответ')).toBeInTheDocument());

    // The live copy carries the same persisted message id → same event, not a new turn.
    emit({ kind: 'pi', name: 'message_end', data: { message: { id: 'h1', role: 'user', content: 'вопрос' } } });
    emit({ kind: 'pi', name: 'message_end', data: { message: { id: 'h2', role: 'assistant', content: [{ type: 'text', text: 'ответ' }] } } });
    await waitFor(() => expect(screen.getAllByText('ответ')).toHaveLength(1));
    expect(screen.getAllByText('вопрос')).toHaveLength(1);
  });

  it('does not show file A read error after switching to file B', async () => {
    const { api } = makeApi({
      errors: { readSession: Object.assign(new Error('boom'), { code: 'SESSION_UNREADABLE' }) },
    });
    const { rerender } = render(<Harness api={api} file={FILE_A} />);
    await screen.findByTestId('chat-history-error');

    // A clean read for B: the old file's error must not survive the switch.
    const { api: api2 } = makeApi({ pages: { [FILE_B]: [{ entries: [msg('b1', 'user', 'файл Б')], nextCursor: null, truncated: false }] } });
    rerender(<Harness api={api2} file={FILE_B} />);
    // First frame of file B: the old file's error must already be gone.
    expect(screen.queryByTestId('chat-history-error')).not.toBeInTheDocument();
    await screen.findByText('файл Б');
    expect(screen.queryByTestId('chat-history-error')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* P2-A — no cross-session frame                                      */
/* ------------------------------------------------------------------ */
describe('R07 r01 P2-A — a session switch never shows the previous file', () => {
  it('drops file A messages immediately, before file B resolves', async () => {
    let resolveB: (p: Page) => void = () => undefined;
    const slowB = new Promise<Page>((res) => {
      resolveB = res;
    });
    const { api } = makeApi({
      pages: {
        [FILE_A]: [{ entries: [msg('a1', 'user', 'СООБЩЕНИЕ ФАЙЛА А')], nextCursor: null, truncated: false }],
        [FILE_B]: [slowB],
      },
    });
    const { rerender } = render(<Harness api={api} file={FILE_A} />);
    await screen.findByText('СООБЩЕНИЕ ФАЙЛА А');

    rerender(<Harness api={api} file={FILE_B} />);
    // the very first render for file B must not contain file A content
    expect(screen.queryByText('СООБЩЕНИЕ ФАЙЛА А')).not.toBeInTheDocument();

    resolveB({ entries: [msg('b1', 'user', 'сообщение файла Б')], nextCursor: null, truncated: false });
    await screen.findByText('сообщение файла Б');
    expect(screen.queryByText('СООБЩЕНИЕ ФАЙЛА А')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* P2-B — compact, still explicit, Pi RPC open gate                   */
/* ------------------------------------------------------------------ */
describe('R07 r01 P2-B — compact explicit open gate', () => {
  it('renders one short action group, does not open by itself, and still asks for the click', async () => {
    const user = userEvent.setup();
    const { api, request } = makeApi({ pages: { [FILE_A]: [] } });
    render(<Harness api={api} file={FILE_A} />);

    const gate = await screen.findByTestId('chat-open-notice');
    // one sentence, not a two-line disclosure
    const text = (gate.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toMatch(/Pi RPC/i);
    expect(within(gate).getByRole('button', { name: /открыть чат/i })).toBeInTheDocument();

    expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(false);
    await user.click(within(gate).getByRole('button', { name: /открыть чат/i }));
    await waitFor(() => expect(request.mock.calls.some((c) => c[0] === 'openSession')).toBe(true));
  });
});
