/**
 * Session detail: История (read-only preview) | Чат (explicit write path).
 */
import { useState } from 'react';
import type { DesktopApi } from './api';
import { HistoryView } from './HistoryView';
import { ChatPane } from './ChatPane';
import type { SessionInfoT } from './types';

export function SessionDetail({ api, session }: { api: DesktopApi; session: SessionInfoT }) {
  const [tab, setTab] = useState<'history' | 'chat'>('history');
  return (
    <section className="detail" data-testid="session-detail">
      <header className="detail-head">
        <h3>{session.name ?? session.id.slice(0, 8)}</h3>
        <span className="muted">{session.file}</span>
        {session.activeWrite && <span className="badge badge-active">запись</span>}
        {session.availability !== 'ok' && <span className="badge badge-warn">⚠ {session.diagnostics ?? session.availability}</span>}
      </header>
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
      ) : (
        <ChatPane key={session.id} api={api} file={session.file} />
      )}
    </section>
  );
}
