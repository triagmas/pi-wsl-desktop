/**
 * Chat pane (M1): the user-facing write boundary. The session is never
 * opened automatically — only an explicit button click calls openSession;
 * prompts, interrupt and close are explicit actions too (Issue #5 gate 5).
 */
import { useState, type FormEvent } from 'react';
import type { DesktopApi } from './api';
import { useChat } from './useChat';
import { SafeMarkdown } from './SafeMarkdown';

export function ChatPane({ api, file }: { api: DesktopApi | null; file: string }) {
  const { state, open, send, interrupt, closeChat } = useChat(api, file);
  const [draft, setDraft] = useState('');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (draft.trim() === '' || state.status !== 'open') return;
    void send(draft);
    setDraft('');
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
          <button type="button" className="primary" onClick={() => void open()}>
            Открыть чат
          </button>
          <p className="muted">
            Чат пишет в сессию только через официальный Pi RPC — каждый шаг требует вашего действия.
          </p>
        </div>
      )}

      {isOpenLike && (
        <>
          <div className="chat-status-row">
            <span data-testid="chat-status">{state.status === 'sending' ? 'Генерация…' : 'Чат открыт'}</span>
            <button type="button" onClick={() => void closeChat()}>
              Закрыть чат
            </button>
          </div>
          <div className="chat-tools" data-testid="tools">
            {state.tools.map((t) => (
              <span key={t.id} className={t.error ? 'tool tool-error' : 'tool'}>
                {t.error ? '✗' : t.done ? '✓' : '⏳'} {t.name}
              </span>
            ))}
          </div>
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
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Сообщение…"
              aria-label="Сообщение"
              disabled={state.status !== 'open'}
              onKeyDown={(e) => {
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
        </>
      )}
    </div>
  );
}
