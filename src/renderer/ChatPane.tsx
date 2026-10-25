/**
 * Chat pane (D2): тот же явный write-boundary (M1: открытие/промпт/прерывание
 * только по клику, финализация по message_end, ошибки/реконнект), но
 * презентация — одобренный ui/ChatView: user-пузыри, ответы Pi, живые шаги
 * инструментов (steps реального tool-state), notice-блок уведомлений и
 * управляемый композер (textarea + отправка + прерывание).
 * Поведенческие контракты tests/ui/m1Chat.test.tsx сохранены 1:1.
 */
import type { FormEvent, ReactNode } from 'react';
import { SafeMarkdown } from './SafeMarkdown';
import type { ChatController } from './useChat';
import { ChatView, type ChatTurn, type ChatTurnAssistant } from './ui/ChatView';

export interface ChatPaneProps {
  /** Controller + composer draft live above the panel (§9.1 item 4): hiding
   * panels, switching views or themes never drops them or aborts the stream. */
  chat: ChatController;
  draft: string;
  onDraftChange: (value: string) => void;
}

export function ChatPane({ chat, draft, onDraftChange }: ChatPaneProps) {
  const { state, open, send, interrupt, closeChat } = chat;

  const submit = (e?: FormEvent): void => {
    e?.preventDefault();
    if (draft.trim() === '' || state.status !== 'open') return;
    void send(draft);
    onDraftChange('');
  };

  const isOpenLike = state.status === 'open' || state.status === 'sending';
  const canSubmit = state.status === 'open' && draft.trim() !== '';

  /* ------------------------------------------------------------------ *
   * Уведомления (notice-слот ChatView): banner / error+retry / спиннер /
   * статус-строка с прерыванием / явный gate открытия.
   * ------------------------------------------------------------------ */
  const notice: ReactNode = (
    <>
      {state.banner && (
        <div className="error-box" role="alert" data-testid="chat-banner">
          <strong>{state.banner.code}</strong> — {state.banner.message}. Откройте чат заново, когда будет готовы.
        </div>
      )}
      {state.error && (
        <div className="error-box" role="alert" data-testid="chat-error">
          <strong>{state.error.code}</strong> — {state.error.message}
          <div>
            <button type="button" onClick={() => void open()}>
              Повторить подключение
            </button>
          </div>
        </div>
      )}
      {state.status === 'opening' && (
        <div className="loading-row">
          <span data-testid="spinner" className="spinner" aria-hidden="true" />
          <span>Подключение к сессии…</span>
        </div>
      )}
      {state.status === 'error' && !state.error && (
        <div className="error-box" role="alert">Не удалось открыть чат</div>
      )}
      {!isOpenLike && state.status !== 'opening' && (
        <div className="chat-actions">
          <button type="button" className="primary" onClick={() => void open()}>
            Открыть чат
          </button>
          <p className="muted">
            Чат пишет в сессию только через официальный Pi RPC — каждый шаг требует вашего действия.
          </p>
        </div>
      )}
      {isOpenLike && (
        <div className="chat-status-row">
          <span data-testid="chat-status">
            {state.status === 'sending' ? 'Генерация…' : 'Чат открыт'}
          </span>
          {state.status === 'sending' && (
            <button type="button" data-testid="interrupt" onClick={() => void interrupt()}>
              Прервать
            </button>
          )}
          <button type="button" onClick={() => void closeChat()}>
            Закрыть чат
          </button>
        </div>
      )}
    </>
  );

  /* ------------------------------------------------------------------ *
   * Лента: записи сессии → user/assistant-ходы; стрим — отдельный ход
   * с живыми шагами реального tool-state (state.tools).
   * ------------------------------------------------------------------ */
  const turns: ChatTurn[] = state.entries.map((entry) => {
    if (entry.kind === 'user') {
      return { kind: 'user', id: entry.key, text: entry.text };
    }
    const turn: ChatTurnAssistant = {
      kind: 'assistant',
      id: entry.key,
      body: <SafeMarkdown text={entry.text} />,
    };
    return turn;
  });

  const toolSteps = state.tools.map((tool) => ({
    id: tool.id,
    // Глиф состояния в тексте: шаг честно показывает «выполняется/готово/ошибка».
    text: `${tool.name} ${tool.error ? '✗' : tool.done ? '✓' : '⏳'}`,
    active: !tool.done && !tool.error,
    more: undefined,
  }));
  const streaming = state.status === 'sending' || state.streamText !== '' || state.tools.length > 0;
  if (streaming && isOpenLike) {
    turns.push({
      kind: 'assistant',
      id: 'live',
      body: state.streamText !== '' ? <SafeMarkdown text={state.streamText} /> : null,
      steps: toolSteps,
      stepsTestId: 'tools',
    });
  }

  return (
    <div className="dl-chatpane" data-testid="chat-pane">
      <ChatView
        notice={notice}
        turns={turns}
        showIdentity={false}
        stepCircle={26}
        composer={
          isOpenLike
            ? {
                placeholder: 'Сообщение…',
                density: 'standard',
                value: draft,
                onValueChange: onDraftChange,
                onSubmit: () => submit(),
                submitDisabled: !canSubmit,
                inputDisabled: state.status !== 'open',
              }
            : null
        }
      />
    </div>
  );
}
