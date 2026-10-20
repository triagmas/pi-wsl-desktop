import { useState } from 'react';
import './index.css';
import { getDesktopApi, type DesktopApi } from './api';
import { StatusPanel } from './StatusPanel';
import { SessionsView } from './SessionsView';
import { useConnection } from './useConnection';

export interface AppProps {
  /** Injectable for tests; by default the preload contextBridge API is used. */
  api?: DesktopApi | null;
}

type View = 'status' | 'sessions';

export function App({ api }: AppProps = {}) {
  const effectiveApi = api === undefined ? getDesktopApi() : api;
  const { snapshot, requestError, retry, selectDistro, refreshRuntime } = useConnection(effectiveApi);
  const [view, setView] = useState<View>('status');

  return (
    <main data-testid="app-root" className="app">
      <h1>Pi WSL Desktop</h1>
      <p className="subtitle">Foundation &amp; Sessions · M0 + M1</p>
      <nav className="main-tabs" data-testid="main-tabs">
        <button
          type="button"
          data-testid="tab-status"
          className={view === 'status' ? 'tab tab-active' : 'tab'}
          aria-pressed={view === 'status'}
          onClick={() => setView('status')}
        >
          Статус
        </button>
        <button
          type="button"
          data-testid="tab-sessions"
          className={view === 'sessions' ? 'tab tab-active' : 'tab'}
          aria-pressed={view === 'sessions'}
          onClick={() => setView('sessions')}
        >
          Сессии
        </button>
      </nav>
      {view === 'status' ? (
        <StatusPanel
          snapshot={snapshot}
          requestError={requestError}
          api={effectiveApi}
          onRetry={() => void retry()}
          onRefresh={() => void refreshRuntime()}
          onSelectDistro={(d) => void selectDistro(d)}
        />
      ) : (
        <SessionsView api={effectiveApi} />
      )}
    </main>
  );
}
