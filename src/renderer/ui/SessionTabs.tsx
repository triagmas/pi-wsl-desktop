/**
 * UI21 C / L1: общий таб-переключатель сессии «История | Чат».
 * Ровно один узел на продукт (App.tsx) и Design Lab (AppScreenLab) —
 * единая композиция D3-решения владельца (#6398531407): контракт
 * role=tablist/tab, aria-selected, testid tab-history/tab-chat и классы
 * .dl-session-tab[-active] не расходятся между средами.
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export type SessionTabMode = 'history' | 'chat';

export function SessionTabs({
  mode,
  onChange,
}: {
  mode: SessionTabMode;
  onChange: (mode: SessionTabMode) => void;
}) {
  /* R02: roving tabindex + стрелки/Home/End — tablist управляется с клавиатуры. */
  const refs = useRef<Record<SessionTabMode, HTMLButtonElement | null>>({ history: null, chat: null });
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: SessionTabMode) => {
    let target: SessionTabMode | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') target = id === 'history' ? 'chat' : 'history';
    else if (event.key === 'Home') target = 'history';
    else if (event.key === 'End') target = 'chat';
    if (!target) return;
    event.preventDefault();
    onChange(target);
    refs.current[target]?.focus();
  };

  return (
    <div className="dl-session-tabs" role="tablist" aria-label="Режим сессии">
      <button
        type="button"
        role="tab"
        data-testid="tab-history"
        aria-selected={mode === 'history'}
        tabIndex={mode === 'history' ? 0 : -1}
        ref={(el) => { refs.current.history = el; }}
        className={`dl-session-tab${mode === 'history' ? ' dl-session-tab-active' : ''}`}
        onClick={() => onChange('history')}
        onKeyDown={(event) => onTabKeyDown(event, 'history')}
      >
        История
      </button>
      <button
        type="button"
        role="tab"
        data-testid="tab-chat"
        aria-selected={mode === 'chat'}
        tabIndex={mode === 'chat' ? 0 : -1}
        ref={(el) => { refs.current.chat = el; }}
        className={`dl-session-tab${mode === 'chat' ? ' dl-session-tab-active' : ''}`}
        onClick={() => onChange('chat')}
        onKeyDown={(event) => onTabKeyDown(event, 'chat')}
      >
        Чат
      </button>
    </div>
  );
}
