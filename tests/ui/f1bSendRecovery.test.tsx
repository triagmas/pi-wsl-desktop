/**
 * UI21 F1-B R02 (P1) — безопасное восстановление после тайм-аута отправки.
 *
 * Реальный отказ: первая отправка вернула тайм-аут ACK. Требования:
 *  - текст пользователя НЕ теряется, если приём не подтверждён;
 *  - UI показывает причину (`BRIDGE_TIMEOUT`), а не «UNKNOWN»;
 *  - автоматической повторной отправки нет;
 *  - поздний ACK/стриминг не создаёт дубль;
 *  - явный повтор не отправляет второе сообщение, если Pi уже принял первое.
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

const READY: RendererSnapshot = { phase: 'ready', attempt: 0, distro: 'Ubuntu', distros: null, runtime: null };
const FILE = '/root/--work-repo--/s1.jsonl';

const TIMEOUT_TEXT =
  "Error invoking remote method 'bridge:request': Error: BRIDGE_TIMEOUT: request sendPrompt timed out after 75000ms";

const STATE = {
  sessionId: 's1',
  sessionFile: FILE,
  isStreaming: false,
  isCompacting: false,
  messageCount: 0,
  model: { id: 'model-one', name: 'Model One', provider: 'prov-a' },
  thinkingLevel: 'off',
};

function makeApi(opts: { sendPrompt: () => Promise<unknown> }) {
  // см. определение ниже; вынесено, чтобы тесты могли управлять моментом ACK
  const chatSubs: Array<(p: unknown) => void> = [];
  const request = vi.fn(async (method: string) => {
    switch (method) {
      case 'openSession':
        return { state: STATE };
      case 'sendPrompt':
        return opts.sendPrompt();
      case 'getAvailableModels':
        return { models: [] };
      case 'getThinkingLevels':
        return { levels: ['off'], current: 'off' };
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
      chatSubs.push(cb as (p: unknown) => void);
      return () => {
        chatSubs.length = 0;
      };
    },
    getAppearance: async () => undefined,
    saveAppearance: async () => undefined,
    resetAppearance: async () => undefined,
  };
  // UI26 R03: bridge штампует КАЖДОЕ событие ключом своего RPC-соединения;
  // тест повторяет этот контракт (keyless-события намеренно отбрасываются).
  return {
    api,
    request,
    emit: (p: ChatEventT) => [...chatSubs].forEach((cb) => cb({ key: `file:${FILE}`, ...p } as ChatEventT)),
  };
}

function Harness({ api }: { api: DesktopApi }) {
  const chat = useChat(api, FILE);
  const [draft, setDraft] = useState('');
  return <ChatPane chat={chat} draft={draft} onDraftChange={setDraft} api={api} file={FILE} />;
}

async function openChat() {
  await userEvent.click(await screen.findByRole('button', { name: /открыть чат/i }));
  await waitFor(() => expect(screen.getByTestId('chat-status')).toBeTruthy());
}

const sendPromptCalls = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter((c) => c[0] === 'sendPrompt').length;

describe('тайм-аут ACK при отправке', () => {
  it('показывает BRIDGE_TIMEOUT и сохраняет текст пользователя', async () => {
    const { api } = makeApi({ sendPrompt: async () => { throw new Error(TIMEOUT_TEXT); } });
    render(<Harness api={api} />);
    await openChat();

    const input = (await screen.findByPlaceholderText(/сообщение/i)) as HTMLTextAreaElement;
    await userEvent.type(input, 'ping owner');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));

    const alert = await screen.findByTestId('chat-error');
    expect(alert.textContent).toContain('BRIDGE_TIMEOUT');
    expect(alert.textContent).not.toContain('UNKNOWN');
    expect(alert.textContent).not.toMatch(/invoking remote method/);
    // текст не потерян — он остаётся в поле ввода
    await waitFor(() => expect(input.value).toBe('ping owner'));
  });

  it('не отправляет автоматически повторно', async () => {
    const { api, request } = makeApi({ sendPrompt: async () => { throw new Error(TIMEOUT_TEXT); } });
    render(<Harness api={api} />);
    await openChat();
    await userEvent.type(await screen.findByPlaceholderText(/сообщение/i), 'ping owner');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await screen.findByTestId('chat-error');
    // даём шанс любым таймерам/эффектам сработать
    await new Promise((r) => setTimeout(r, 30));
    expect(sendPromptCalls(request)).toBe(1);
  });

  it('поздний ACK: явный повтор не дублирует уже принятое сообщение', async () => {
    let attempt = 0;
    const { api, request, emit } = makeApi({
      sendPrompt: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error(TIMEOUT_TEXT);
        return { disposition: 'started' };
      },
    });
    render(<Harness api={api} />);
    await openChat();
    await userEvent.type(await screen.findByPlaceholderText(/сообщение/i), 'ping owner');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await screen.findByTestId('chat-error');

    // Pi всё-таки принял промпт: приходит событие с этим текстом.
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { id: 'm-user-1', role: 'user', content: [{ type: 'text', text: 'ping owner' }] } },
    });
    await waitFor(() => expect(screen.getByText('ping owner')).toBeTruthy());

    const retry = screen.getByRole('button', { name: /повторить отправку/i });
    await userEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('chat-banner')).toBeTruthy());
    expect(sendPromptCalls(request)).toBe(1);
  });

  it('после тайм-аута стриминг продолжается и даёт один ход без дублей', async () => {
    const { api, emit } = makeApi({ sendPrompt: async () => { throw new Error(TIMEOUT_TEXT); } });
    render(<Harness api={api} />);
    await openChat();
    await userEvent.type(await screen.findByPlaceholderText(/сообщение/i), 'ping owner');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await screen.findByTestId('chat-error');

    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { id: 'm-user-1', role: 'user', content: [{ type: 'text', text: 'ping owner' }] } },
    });
    emit({
      kind: 'pi',
      name: 'message_update',
      data: { assistantMessageEvent: { type: 'text_delta', delta: 'pong' } },
    });
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { id: 'm-a-1', role: 'assistant', content: [{ type: 'text', text: 'pong' }] } },
    });

    // Считаем ХОДЫ, а не текстовые узлы (markdown-рендер даёт p+span на одну фразу).
    await waitFor(() => expect(document.querySelectorAll('.dl-turn-assistant').length).toBe(1));
    expect(document.querySelectorAll('.dl-turn-user').length).toBe(1);
    expect(document.querySelectorAll('.dl-bubble-user').length).toBe(1);
    // живой стрим не остаётся параллельной копией финального сообщения
    expect(screen.queryByTestId('chat-status')?.textContent ?? '').not.toContain('Генерация');
  });
});

describe('восстановление: доставка, замеченная ДО тайм-аута (ревью 2, P2)', () => {
  for (const via of ['повторить отправку', 'отправить'] as const) {
    it(`не отправляет второй раз, если запись пришла до тайм-аута (${via})`, async () => {
      let attempt = 0;
      const { api, request, emit } = makeApi({
        sendPrompt: async () => {
          attempt += 1;
          if (attempt === 1) {
            // пока ACK не пришёл, Pi уже записал сообщение — это доставка
            emit({
              kind: 'pi',
              name: 'message_end',
              data: { message: { id: 'm-early', role: 'user', content: [{ type: 'text', text: 'ping owner' }] } },
            });
            await new Promise((r) => setTimeout(r, 10));
            throw new Error(TIMEOUT_TEXT);
          }
          return { disposition: 'started' };
        },
      });
      render(<Harness api={api} />);
      await openChat();
      const input = (await screen.findByPlaceholderText(/сообщение/i)) as HTMLTextAreaElement;
      await userEvent.type(input, 'ping owner');
      await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
      await screen.findByTestId('chat-error');
      await waitFor(() => expect(document.querySelectorAll('.dl-bubble-user').length).toBe(1));

      await userEvent.click(screen.getByRole('button', { name: new RegExp(via, 'i') }));
      await waitFor(() => expect(screen.getByTestId('chat-banner').textContent).toContain('DELIVERED'));
      expect(sendPromptCalls(request)).toBe(1);
    });
  }
});

describe('восстановление: решения по доставке (ревью P1/P2)', () => {
  it('обычный Send не дублирует уже принятое сообщение после позднего ACK', async () => {
    let attempt = 0;
    const { api, request, emit } = makeApi({
      sendPrompt: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error(TIMEOUT_TEXT);
        return { disposition: 'started' };
      },
    });
    render(<Harness api={api} />);
    await openChat();
    const input = (await screen.findByPlaceholderText(/сообщение/i)) as HTMLTextAreaElement;
    await userEvent.type(input, 'ping owner');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await screen.findByTestId('chat-error');

    // Pi всё-таки принял промпт — приходит пользовательская запись.
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { id: 'm-u1', role: 'user', content: [{ type: 'text', text: 'ping owner' }] } },
    });
    await waitFor(() => expect(document.querySelectorAll('.dl-bubble-user').length).toBe(1));

    // пользователь жмёт ОБЫЧНУЮ отправку (черновик сохранился)
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(screen.getByTestId('chat-banner').textContent).toContain('DELIVERED'));
    expect(sendPromptCalls(request)).toBe(1);
  });

  it('ранее отправленный такой же текст не «подтверждает» доставку нового', async () => {
    let attempt = 0;
    const { api, request, emit } = makeApi({
      sendPrompt: async () => {
        attempt += 1;
        if (attempt === 2) throw new Error(TIMEOUT_TEXT);
        return { disposition: 'started' };
      },
    });
    render(<Harness api={api} />);
    await openChat();
    const input = (await screen.findByPlaceholderText(/сообщение/i)) as HTMLTextAreaElement;

    // 1) успешная отправка того же текста (завершаем ход, иначе композер закрыт)
    await userEvent.type(input, 'continue');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(sendPromptCalls(request)).toBe(1));
    // Pi действительно записал ЭТО сообщение — иначе тест ничего не проверяет.
    emit({
      kind: 'pi',
      name: 'message_end',
      data: { message: { id: 'm-old', role: 'user', content: [{ type: 'text', text: 'continue' }] } },
    });
    await waitFor(() => expect(document.querySelectorAll('.dl-bubble-user').length).toBe(1));
    emit({ kind: 'pi', name: 'agent_settled', data: {} });
    await waitFor(() => expect(screen.getByTestId('chat-status').textContent).toBe('Чат открыт'));

    // 2) тот же текст, но отправка НЕ подтверждена
    await userEvent.type(input, 'continue');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));
    await waitFor(() => expect(sendPromptCalls(request)).toBe(2));
    await screen.findByTestId('chat-error');

    // 3) явный повтор обязан реально отправить, а не «подтвердить» доставку
    await userEvent.click(screen.getByRole('button', { name: /повторить отправку/i }));
    await waitFor(() => expect(sendPromptCalls(request)).toBe(3));
    expect(screen.queryByTestId('chat-banner')?.textContent ?? '').not.toContain('DELIVERED');
  });

  it('поздний ACK не стирает черновик, набранный после завершения хода', async () => {
    let resolveSend: (v: unknown) => void = () => undefined;
    const { api, emit } = makeApi({
      sendPrompt: () => new Promise((resolve) => { resolveSend = resolve; }),
    });
    render(<Harness api={api} />);
    await openChat();
    const input = (await screen.findByPlaceholderText(/сообщение/i)) as HTMLTextAreaElement;
    await userEvent.type(input, 'first message');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));

    // Pi закончил ход ДО ACK (это поддержано клиентом) → поле ввода снова активно
    emit({ kind: 'pi', name: 'agent_settled', data: {} });
    await waitFor(() => expect(screen.getByTestId('chat-status').textContent).toBe('Чат открыт'));
    await userEvent.type(input, 'second draft');

    const draftAfterEdit = input.value;
    expect(draftAfterEdit).not.toBe('first message');
    resolveSend({ disposition: 'started' });
    await new Promise((r) => setTimeout(r, 40));
    // ACK относится к ДРУГОЙ ревизии черновика — стирать нельзя
    expect(input.value).toBe(draftAfterEdit);
  });
});
