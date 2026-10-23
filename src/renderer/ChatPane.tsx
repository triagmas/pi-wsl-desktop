/**
 * Chat pane (M1): the user-facing write boundary. The session is never
 * opened automatically — only an explicit button click calls openSession;
 * prompts, interrupt and close are explicit actions too (Issue #5 gate 5).
 * R02 A3: the composer is anchored at the bottom in every state (disabled
 * until the chat is opened); the message list scrolls independently above it.
 */
import type { FormEvent } from 'react';
import { SafeMarkdown } from './SafeMarkdown';
import { IconCheck, IconClock, IconXCircle } from './shell/icons';
import type { ChatController } from './useChat';

export interface ChatPaneProps {
  /** Controller + composer draft live above the panel (§9.1 item 4): hiding
   * panels, switching views or themes never drops them or aborts the stream. */
  chat: ChatController;
  draft: string;
  onDraftChange: (value: string) => void;
}

export function ChatPane({ chat, draft, onDraftChange }: ChatPaneProps) {
  const { state, open, send, interrupt, closeChat } = chat;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (draft.trim() === '' || state.status !== 'open') return;
    void send(draft);
    onDraftChange('');
  };

  const isOpenLike = state.status === 'open' || state.status === 'sending';

  return (
    <div className="chat" data-testid="chat-pane">
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
      {state.status === 'error' && !state.error && <div className="error-box" role="alert">Не удалось открыть чат</div>}

      {!isOpenLike && state.status !== 'opening' && (
        <div className="chat-actions">
          <button type="button" className="btn-primary" data-testid="open-chat" onClick={() => void open()}>
            Открыть чат
          </button>
          <p className="muted">
            Чат пишет в сессию только через официальный Pi RPC — каждый шаг требует вашего действия.
          </p>
        </div>
      )}

      {isOpenLike && (
        <div className="chat-status-row">
          <span data-testid="chat-status">{state.status === 'sending' ? 'Генерация…' : 'Чат открыт'}</span>
          <button type="button" onClick={() => void closeChat()}>
            Закрыть чат
          </button>
        </div>
      )}

      {isOpenLike && (
        <div className="chat-tools" data-testid="tools">
          {state.tools.map((t) => (
            <span key={t.id} className={t.error ? 'tool tool-error' : 'tool'}>
              <span
                className={`tool-state tool-state-${t.error ? 'error' : t.done ? 'done' : 'running'}`}
                aria-hidden="true"
              >
                {t.error ? <IconXCircle /> : t.done ? <IconCheck /> : <IconClock />}
              </span>
              {t.name}
            </span>
          ))}
        </div>
      )}

      <div className="chat-entries" data-testid="chat-entries">
        {state.entries.map((entry) => (
          <div key={entry.key} className={`bubble bubble-${entry.kind}`}>
            <span className="bubble-role">{entry.kind}</span>
            <SafeMarkdown text={entry.text} />
          </div>
        ))}
        {state.streamText !== '' && (
          <div className="bubble bubble-assistant bubble-stream" data-testid="stream">
            <span className="bubble-role">assistant</span>
            <SafeMarkdown text={state.streamText} />
          </div>
        )}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <textarea
          data-testid="chat-composer"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={state.status === 'open' ? 'Сообщение…' : 'Откройте чат, чтобы написать…'}
          aria-label="Сообщение"
          disabled={state.status !== 'open'}
          onKeyDown={(e) => {
            // IME composition must never submit (R02 A3).
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
        />
        <div className="chat-buttons">
          <button type="submit" className="primary" disabled={state.status !== 'open' || draft.trim() === ''}>
            Отправить
          </button>
          {state.status === 'sending' && (
            <button type="button" data-testid="interrupt" onClick={() => void interrupt()}>
              Прервать
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
