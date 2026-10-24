/**
 * Chat pane (M1/R03 п.1): the user-facing write boundary. Selecting a session
 * never opens it — the composer is usable at once and the explicit SEND is
 * the explicit open action (Issue #5 gate 5: «starts only on explicit click
 * or send»); prompts, interrupt and close stay explicit too. Stored history
 * renders in the same scroll above the live entries; the composer is anchored
 * at the bottom in every state.
 */
import { useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { SafeMarkdown } from './SafeMarkdown';
import { HistoryBubbles, HistoryErrorBox, HistoryLoading, HistoryMore, HistoryNotices } from './historyFeed';
import type { HistoryFeed } from './historyFeed';
import { IconCheck, IconClock, IconXCircle } from './shell/icons';
import type { ChatController } from './useChat';

export interface ChatPaneProps {
  /** Controller + composer draft live above the panel (§9.1 item 4): hiding
   * panels, switching views or themes never drops them or aborts the stream. */
  chat: ChatController;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Stored conversation (loaded by SessionDetail). Omitted only in
   * controller-level unit harnesses that exercise the write path alone. */
  feed?: HistoryFeed;
}

export function ChatPane({ chat, draft, onDraftChange, feed }: ChatPaneProps) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const wasSending = useRef(false);
  useEffect(() => {
    // R01 rule 14 (review: focus contract): when a generation settles the
    // focus returns to the composer — the send button was focused, the
    // disabled textarea dropped it, and typing must continue without a click.
    const sending = chat.state.status === 'sending';
    if (wasSending.current && !sending) composerRef.current?.focus();
    wasSending.current = sending;
  }, [chat.state.status]);

  const { state, open, send, interrupt, closeChat } = chat;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const text = draft;
    if (text.trim() === '') return;
    if (state.status === 'opening' || state.status === 'sending') return;
    if (state.status === 'open') {
      void send(text);
      onDraftChange('');
      return;
    }
    // R03 п.1: the composer is always usable — an explicit send is the
    // explicit action that opens the session first (open → prompt order),
    // and a failed open keeps the draft for the retry below.
    void (async () => {
      const ok = await open();
      if (!ok) return;
      void send(text);
      onDraftChange('');
    })();
  };

  const isOpenLike = state.status === 'open' || state.status === 'sending';
  const composerLocked = state.status === 'opening' || state.status === 'sending';

  return (
    <div className="chat" data-testid="chat-pane">
      {state.banner && (
        <div className="error-box" role="alert" data-testid="chat-banner">
          <strong>{state.banner.code}</strong> — {state.banner.message}
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
        {feed && (
          <>
            {feed.error && <HistoryErrorBox feed={feed} />}
            {!feed.result && feed.loading && <HistoryLoading />}
            {feed.result && (
              <>
                <HistoryNotices feed={feed} />
                <HistoryBubbles result={feed.result} />
                {/* newer stored pages sit chronologically before the live
                    run: history · load-more · live entries */}
                <HistoryMore feed={feed} />
              </>
            )}
          </>
        )}
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
          ref={composerRef}
          data-testid="chat-composer"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Сообщение…"
          aria-label="Сообщение"
          disabled={composerLocked}
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
          <button type="submit" className="primary" disabled={composerLocked || draft.trim() === ''}>
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
