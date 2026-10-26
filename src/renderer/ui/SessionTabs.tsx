/**
 * UI21 C / L1: общий таб-переключатель сессии «История | Чат».
 * Ровно один узел на продукт (App.tsx) и Design Lab (AppScreenLab) —
 * единая композиция D3-решения владельца (#6398531407): контракт
 * role=tablist/tab, aria-selected, testid tab-history/tab-chat и классы
 * .dl-session-tab[-active] не расходятся между средами.
 */
export type SessionTabMode = 'history' | 'chat';

export function SessionTabs({
  mode,
  onChange,
}: {
  mode: SessionTabMode;
  onChange: (mode: SessionTabMode) => void;
}) {
  return (
    <div className="dl-session-tabs" role="tablist" aria-label="Режим сессии">
      <button
        type="button"
        role="tab"
        data-testid="tab-history"
        aria-selected={mode === 'history'}
        className={`dl-session-tab${mode === 'history' ? ' dl-session-tab-active' : ''}`}
        onClick={() => onChange('history')}
      >
        История
      </button>
      <button
        type="button"
        role="tab"
        data-testid="tab-chat"
        aria-selected={mode === 'chat'}
        className={`dl-session-tab${mode === 'chat' ? ' dl-session-tab-active' : ''}`}
        onClick={() => onChange('chat')}
      >
        Чат
      </button>
    </div>
  );
}
