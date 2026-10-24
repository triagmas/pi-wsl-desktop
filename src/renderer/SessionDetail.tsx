/**
 * Session detail (R03 п.1): the conversation-first surface — the stored
 * history renders immediately in the SAME scroll as the composer, there is
 * no История/Чат tab framing, and selecting a session never opens a write
 * session (read-only; Issue #5 gate 5: open only on explicit click/send).
 */
import type { DesktopApi } from './api';
import { HistoryFeedView, useHistoryFeed } from './historyFeed';
import { ChatPane } from './ChatPane';
import type { SessionInfoT } from './types';

export interface SessionDetailProps {
  api: DesktopApi;
  session: SessionInfoT;
  /** Active chat controller + draft for the viewed session (§9.1 item 4). */
  chat?: import('./useChat').ChatController;
  draft?: string;
  onDraftChange?: (value: string) => void;
}

export function SessionDetail({ api, session, chat, draft = '', onDraftChange }: SessionDetailProps) {
  const feed = useHistoryFeed(api, session.file);
  return (
    <section className="detail" data-testid="session-detail">
      {chat && onDraftChange ? (
        <ChatPane chat={chat} draft={draft} onDraftChange={onDraftChange} feed={feed} />
      ) : (
        <>
          <div className="history" data-testid="history">
            <HistoryFeedView feed={feed} />
          </div>
          <p className="muted" data-testid="chat-unavailable">
            Чат доступен для выбранного диалога в центральной области.
          </p>
        </>
      )}
    </section>
  );
}
