/**
 * Chat workspace (D2): центральная область над одобренным ChatView.
 * Заменяет SessionDetail с сохранением поведенческих контрактов
 * (data-testid session-detail / tab-history / tab-chat, честные бейджи
 * записи/доступности), но рендерится в геометрии app-layout:
 * crumb-row (проект / сессия + вкладки + открытие деталей) и тело
 * История | Чат (реальные HistoryView и ChatPane поверх live useChat).
 */
import { useState, type ReactNode, type Ref } from 'react';
import type { DesktopApi } from '../api';
import { HistoryView } from '../HistoryView';
import { ChatPane } from '../ChatPane';
import type { ChatController } from '../useChat';
import type { SessionInfoT } from '../types';

export interface ChatWorkspaceProps {
  api: DesktopApi;
  session: SessionInfoT;
  chat: ChatController;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Кнопка открытия правой панели: ref нужен для возврата фокуса (§8). */
  detailsRef?: Ref<HTMLButtonElement>;
  detailsOpen: boolean;
  onOpenDetails: () => void;
  /** Страховка переключения сессии (App-level state). */
  guard?: ReactNode;
}

export function ChatWorkspace({
  api,
  session,
  chat,
  draft,
  onDraftChange,
  detailsRef,
  detailsOpen,
  onOpenDetails,
  guard,
}: ChatWorkspaceProps) {
  const [tab, setTab] = useState<'history' | 'chat'>('history');
  const project = session.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Проект';
  const name = session.name ?? session.id.slice(0, 8);

  return (
    <section className="dl-session-detail" data-testid="session-detail">
      <div className="dl-app-crumb">
        <div className="dl-crumb">
          <span className="muted" title={session.projectPath}>
            {project}
          </span>
          <span aria-hidden="true">/</span>
          <strong title={session.file}>{name}</strong>
          {session.activeWrite && <span className="badge badge-active">запись</span>}
          {session.availability !== 'ok' && (
            <span className="badge badge-warn">⚠ {session.diagnostics ?? session.availability}</span>
          )}
        </div>
        <div className="dl-session-tabs" role="tablist" aria-label="Режим сессии">
          <button
            type="button"
            role="tab"
            data-testid="tab-history"
            aria-selected={tab === 'history'}
            className={`dl-session-tab${tab === 'history' ? ' dl-session-tab-active' : ''}`}
            onClick={() => setTab('history')}
          >
            История
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-chat"
            aria-selected={tab === 'chat'}
            className={`dl-session-tab${tab === 'chat' ? ' dl-session-tab-active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Чат
          </button>
        </div>
        <div className="dl-toolbar-actions">
          <button
            type="button"
            ref={detailsRef}
            data-testid="open-details"
            className={`dl-btn-ghost${detailsOpen ? ' dl-btn-accent' : ''}`}
            title="Показать детали"
            aria-label="Показать панель деталей"
            aria-pressed={detailsOpen}
            onClick={onOpenDetails}
          >
            <span aria-hidden="true">|›</span>
          </button>
        </div>
      </div>
      {guard}
      <div className="dl-session-body">
        {tab === 'history' ? (
          <HistoryView api={api} file={session.file} />
        ) : (
          <ChatPane chat={chat} draft={draft} onDraftChange={onDraftChange} />
        )}
      </div>
    </section>
  );
}
