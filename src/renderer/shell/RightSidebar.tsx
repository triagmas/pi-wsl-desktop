/**
 * Right details sidebar (Issue #21 §4): hidden by default, opened from the
 * chat header, ~340px, independent size. Shows REAL tool activity from the
 * active Pi session — no invented files or checks: the «Файлы» tab only
 * appears when the session actually reports file paths (currently the M1
 * event stream carries none, so the tab stays hidden — honest absence).
 */
import type { ChatTool } from '../useChat';

export interface RightSidebarProps {
  width: number;
  tools: ChatTool[];
  streaming: boolean;
  onClose: () => void;
  onCloseTargetRef?: (el: HTMLElement | null) => void;
}

export function RightSidebar({ width, tools, streaming, onClose }: RightSidebarProps) {
  const doneCount = tools.filter((t) => t.done && !t.error).length;
  const errorCount = tools.filter((t) => t.error).length;
  return (
    <aside
      data-testid="right-sidebar"
      className="right-sidebar"
      style={{ width: `${width}px` }}
      aria-label="Детали действия"
    >
      <header className="right-sidebar-head">
        <h2>Детали действия</h2>
        <button
          type="button"
          data-testid="close-details"
          className="icon-btn"
          title="Скрыть панель"
          aria-label="Скрыть панель деталей"
          onClick={onClose}
        >
          <span aria-hidden="true">›</span>
        </button>
      </header>

      <div className="right-sidebar-body" data-testid="details-body">
        <section aria-label="Обзор">
          <div className="details-status" data-testid="details-status">
            {streaming ? (
              <span className="badge badge-active">Выполняется…</span>
            ) : tools.length === 0 ? (
              <span className="badge muted-badge">Действий пока нет</span>
            ) : errorCount > 0 ? (
              <span className="badge badge-error">Ошибок: {errorCount}</span>
            ) : (
              <span className="badge badge-ready">Выполнено</span>
            )}
          </div>

          <h3 className="details-heading">Инструменты</h3>
          {tools.length === 0 ? (
            <p className="muted" data-testid="details-empty">
              Инструменты появятся по мере работы Pi — здесь реальные события текущей сессии.
            </p>
          ) : (
            <ul className="tool-details-list" data-testid="tool-details">
              {tools.map((t) => (
                <li key={t.id} className="tool-detail-row">
                  <span aria-hidden="true">{t.error ? '✗' : t.done ? '✓' : '⏳'}</span>
                  <span className="tool-detail-name">{t.name}</span>
                  <span className="muted">
                    {t.error ? 'ошибка' : t.done ? 'готово' : 'выполняется'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {/* «Файлы» tab is intentionally absent: M1 events carry no file paths
            and Issue #21 §4 forbids inventing changed files. */}
      </div>

      <footer className="right-sidebar-foot muted" data-testid="details-summary">
        {tools.length} инстр. · {doneCount} готово
      </footer>
    </aside>
  );
}
