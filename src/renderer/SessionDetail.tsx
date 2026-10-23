/**
 * Session detail: История (read-only preview) | Чат (explicit write path).
 */
import { useState } from 'react';
import type { DesktopApi } from './api';
import { HistoryView } from './HistoryView';
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
  // R02 A3: a picked session opens straight into its chat — no extra hop.
  // The session NAME lives in the chat header breadcrumb (App) — no second
  // duplicated title block here; only the tabs and the content remain.
  const [tab, setTab] = useState<'history' | 'chat'>('chat');
  return (
    <section className="detail" data-testid="session-detail">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" data-testid="tab-history" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          История
        </button>
        <button type="button" role="tab" data-testid="tab-chat" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
          Чат
        </button>
      </div>
      {tab === 'history' ? (
        <HistoryView api={api} file={session.file} />
      ) : chat && onDraftChange ? (
        <ChatPane chat={chat} draft={draft} onDraftChange={onDraftChange} />
      ) : (
        <p className="muted" data-testid="chat-unavailable">
          Чат доступен для выбранного диалога в центральной области.
        </p>
      )}
    </section>
  );
}
