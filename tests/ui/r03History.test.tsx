/**
 * UI21 F1-B R03 (P1) — «после перезапуска нет истории».
 *
 * Причина, подтверждённая на реальной сессии: одна страница readSession
 * (limit 100 записей) весила ~1.1 МиБ и превышала MAX_FRAME_BYTES, из-за чего
 * bridge выходил с кодом 1, а лента оставалась пустой. Дополнительно первая
 * страница была САМОЙ СТАРОЙ, поэтому даже без падения пользователь видел
 * начало давнего диалога, а не свои последние сообщения.
 *
 * Эти тесты фиксируют поведение панели чата:
 * 1) при открытии грузится ХВОСТ файла (`direction:'backward'`), последний
 *    ответ виден сразу;
 * 2) более ранние записи подгружаются обратным курсором и вставляются СВЕРХУ;
 * 3) показывается разрыв «выше есть ещё», по исчерпании он исчезает;
 * 4) ключи уникальны даже у записей без id, дублей нет;
 * 5) ошибка чтения истории видна явно (никакой «пустой» ленты без объяснения).
 */
import { useState } from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/renderer/ChatPane';
import { useChat } from '../../src/renderer/useChat';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };
const FILE = '/root/--p--/long.jsonl';

type Page = {
  entries: unknown[];
  nextCursor?: string | null;
  prevCursor?: string | null;
  atStart?: boolean;
  truncated?: boolean;
  partialTrailing?: boolean;
  diagnostics?: string[];
};

function makeApi(routes: { pages?: Array<Page | Promise<Page>>; error?: unknown } = {}) {
  const chatSubs: Array<(p: unknown) => void> = [];
  const readCalls: Array<Record<string, unknown>> = [];
  let idx = 0;
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    switch (method) {
      case 'readSession': {
        readCalls.push(params ?? {});
        if (routes.error) throw routes.error;
        const pages = routes.pages ?? [];
        const picked = pages[Math.min(idx, pages.length - 1)] ?? { entries: [] };
        idx += 1;
        // Страница может быть промисом (медленный ответ моста).
        const page = await picked;
        return { partialTrailing: false, diagnostics: [], nextCursor: null, prevCursor: null, atStart: true, truncated: false, ...page };
      }
      case 'openSession':
        return {
          state: {
            sessionId: 's1',
            sessionFile: FILE,
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
  return { api, readCalls, emit: (p: unknown) => [...chatSubs].forEach((cb) => cb(p)) };
}

function Harness({ api, file }: { api: DesktopApi; file: string }) {
  const chat = useChat(api, file);
  const [draft, setDraft] = useState('');
  return <ChatPane api={api} file={file} chat={chat} draft={draft} onDraftChange={setDraft} />;
}

const msg = (id: string | null, role: 'user' | 'assistant', text: string) => ({
  id,
  type: 'message',
  raw: { type: 'message', message: { role, content: role === 'assistant' ? [{ type: 'text', text }] : text } },
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Метрики прокрутки в jsdom: layout нет, поэтому задаём их явно. */
function setMetrics(feed: HTMLElement, m: { scrollTop: number; scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(feed, 'scrollHeight', { value: m.scrollHeight, configurable: true });
  Object.defineProperty(feed, 'clientHeight', { value: m.clientHeight, configurable: true });
  feed.scrollTop = m.scrollTop;
}

const feedEl = () => screen.getByTestId('chat-feed') as HTMLElement;

describe('R03 — панель чата открывается последними сообщениями', () => {
  it('грузит хвост файла: первая страница запрошена как backward, свежий ответ виден сразу', async () => {
    const tail: Page = {
      entries: [msg('u2', 'user', 'второй вопрос'), msg('a2', 'assistant', 'МАРКЕР-824')],
      prevCursor: 'u2',
      atStart: false,
    };
    const { api, readCalls } = makeApi({ pages: [tail] });
    render(<Harness api={api} file={FILE} />);

    await waitFor(() => expect(screen.getByText('МАРКЕР-824')).toBeInTheDocument());
    expect(readCalls[0]).toMatchObject({ file: FILE, direction: 'backward' });
    expect(readCalls[0]).not.toHaveProperty('sinceEntryId');
    // Разрыв «выше есть ещё» стоит ПЕРЕД показанными записями.
    const gap = screen.getByTestId('chat-history-gap');
    const firstTurn = screen.getByText('второй вопрос');
    expect(gap.compareDocumentPosition(firstTurn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gap.textContent ?? '').toMatch(/предыдущ/i);
  });

  it('подгружает более ранние записи обратным курсором и ставит их СВЕРХУ', async () => {
    const user = userEvent.setup();
    const tail: Page = { entries: [msg('u2', 'user', 'второй вопрос'), msg('a2', 'assistant', 'ответ 2')], prevCursor: 'u2', atStart: false };
    const older: Page = { entries: [msg('u1', 'user', 'первый вопрос'), msg('a1', 'assistant', 'ответ 1')], prevCursor: null, atStart: true };
    const { api, readCalls } = makeApi({ pages: [tail, older] });
    render(<Harness api={api} file={FILE} />);

    await waitFor(() => expect(screen.getByText('ответ 2')).toBeInTheDocument());
    await user.click(within(screen.getByTestId('chat-history-gap')).getByTestId('chat-history-more'));

    await waitFor(() => expect(screen.getByText('ответ 1')).toBeInTheDocument());
    expect(readCalls.at(-1)).toMatchObject({ file: FILE, direction: 'backward', beforeEntryId: 'u2' });

    const first = screen.getByText('первый вопрос');
    const second = screen.getByText('второй вопрос');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // atStart → разрыва больше нет.
    expect(screen.queryByTestId('chat-history-gap')).not.toBeInTheDocument();
  });

  it('не дублирует записи при повторных подгрузках и держит ключи уникальными', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const tail: Page = { entries: [msg(null, 'user', 'ид-less 2'), msg(null, 'assistant', 'ответ 2')], prevCursor: 'c1', atStart: false };
    const older: Page = { entries: [msg(null, 'user', 'ид-less 1'), msg(null, 'assistant', 'ответ 1')], prevCursor: null, atStart: true };
    const { api } = makeApi({ pages: [tail, older] });
    render(<Harness api={api} file={FILE} />);

    await waitFor(() => expect(screen.getByText('ответ 2')).toBeInTheDocument());
    await user.click(screen.getByTestId('chat-history-more'));
    await waitFor(() => expect(screen.getByText('ответ 1')).toBeInTheDocument());
    expect(screen.getAllByText('ответ 2')).toHaveLength(1);
    expect(screen.getAllByText('ответ 1')).toHaveLength(1);
    const dupes = errors.mock.calls.filter((c) => String(c[0]).includes('same key'));
    expect(dupes).toEqual([]);
  });

  it('хвост без отображаемых сообщений всё равно даёт доступ к более ранним (ревью P2)', async () => {
    const user = userEvent.setup();
    // Страница-хвост состоит только из служебных записей: пузырей нет, но
    // более ранние записи существуют — кнопка обязана быть.
    const serviceOnly: Page = {
      entries: [
        { id: 's1', type: 'model_change', raw: { type: 'model_change', provider: 'prov-a', modelId: 'm' } },
        { id: 's2', type: 'thinking_level_change', raw: { type: 'thinking_level_change', level: 'off' } },
      ],
      prevCursor: 's1',
      atStart: false,
    };
    const older: Page = { entries: [msg('u1', 'user', 'старый вопрос'), msg('a1', 'assistant', 'старый ответ')], prevCursor: null, atStart: true };
    const { api, readCalls } = makeApi({ pages: [serviceOnly, older] });
    render(<Harness api={api} file={FILE} />);

    const more = await screen.findByTestId('chat-history-more');
    await user.click(more);
    await waitFor(() => expect(screen.getByText('старый ответ')).toBeInTheDocument());
    expect(readCalls.at(-1)).toMatchObject({ file: FILE, direction: 'backward', beforeEntryId: 's1' });
  });

  it('подгрузка старых записей сохраняет видимую позицию (якорь, а не прыжок вниз) (ревью P2)', async () => {
    const user = userEvent.setup();
    const tail: Page = { entries: [msg('u2', 'user', 'второй вопрос'), msg('a2', 'assistant', 'ответ 2')], prevCursor: 'u2', atStart: false };
    let resolveOlder: (p: Page) => void = () => undefined;
    const delayed = new Promise<Page>((res) => {
      resolveOlder = res;
    });
    const { api } = makeApi({ pages: [tail, delayed] });
    render(<Harness api={api} file={FILE} />);

    await waitFor(() => expect(screen.getByText('ответ 2')).toBeInTheDocument());
    const feed = feedEl();
    // Высота ленты зависит от числа сообщений — как в реальном layout: при
    // подгрузке старых записей лента СТАНОВИТСЯ ВЫШЕ ровно в момент вставки.
    Object.defineProperty(feed, 'scrollHeight', {
      configurable: true,
      get: () => 600 + feed.querySelectorAll('.dl-bubble-user').length * 200,
    });
    Object.defineProperty(feed, 'clientHeight', { value: 100, configurable: true });
    // 1 пузырь в хвосте → высота 800; пользователь в середине ленты.
    feed.scrollTop = 500;

    // Пользователь листает вверх и просит более ранние записи.
    fireEvent.scroll(feed);
    await user.click(screen.getByTestId('chat-history-more'));
    // Пока ответ не пришёл, смена текста кнопки НЕ должна израсходовать якорь.
    await waitFor(() => expect(screen.getByTestId('chat-history-more').textContent).toContain('Загрузка'));
    expect(feed.scrollTop).toBe(500); // смена текста кнопки позицию не тронула

    resolveOlder({ entries: [msg('u1', 'user', 'первый вопрос'), msg('a1', 'assistant', 'ответ 1')], prevCursor: null, atStart: true });
    await waitFor(() => expect(screen.getByText('ответ 1')).toBeInTheDocument());
    // Было 800 px (1 пузырь), стало 1000 px (2 пузыря): контент вырос СВЕРХУ на
    // 200 px, поэтому scrollTop = 500 + 200 = 700 — глаз остаётся на том же месте.
    await waitFor(() => expect(feed.scrollTop).toBe(700));
  });

  it('финализация живого хода не вырывает пользователя из чтения вверху (ревью P2)', async () => {
    const tail: Page = { entries: [msg('u1', 'user', 'вопрос'), msg('a1', 'assistant', 'ответ 1')], prevCursor: null, atStart: true };
    const { api, emit } = makeApi({ pages: [tail] });
    render(<Harness api={api} file={FILE} />);
    await waitFor(() => expect(screen.getByText('ответ 1')).toBeInTheDocument());

    const feed = feedEl();
    setMetrics(feed, { scrollTop: 100, scrollHeight: 2000, clientHeight: 100 });
    fireEvent.scroll(feed); // пользователь отлистал вверх (2000−100−100 > 24)

    emit({ kind: 'pi', name: 'message_end', data: { message: { id: 'm-live', role: 'user', content: 'новый вопрос' } } });
    await waitFor(() => expect(screen.getByText('новый вопрос')).toBeInTheDocument());
    expect(feed.scrollTop).toBe(100); // позиция чтения сохранена
  });

  it('ошибка чтения истории видна явно, а не выглядит как пустая сессия', async () => {
    const { api } = makeApi({ error: Object.assign(new Error('bridge exited (code 1)'), { code: 'DISCONNECTED' }) });
    render(<Harness api={api} file={FILE} />);
    const box = await screen.findByTestId('chat-history-error');
    expect(box).toHaveTextContent('DISCONNECTED');
  });
});
