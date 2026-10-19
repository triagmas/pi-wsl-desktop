import './index.css';
import { getDesktopApi, type DesktopApi } from './api';
import { StatusPanel } from './StatusPanel';
import { useConnection } from './useConnection';

export interface AppProps {
  /** Injectable for tests; by default the preload contextBridge API is used. */
  api?: DesktopApi | null;
}

export function App({ api }: AppProps = {}) {
  const effectiveApi = api === undefined ? getDesktopApi() : api;
  const { snapshot, requestError, retry, selectDistro, refreshRuntime } = useConnection(effectiveApi);

  return (
    <main data-testid="app-root" className="app">
      <h1>Pi WSL Desktop</h1>
      <p className="subtitle">Foundation · M0 — связь с Pi внутри WSL</p>
      <StatusPanel
        snapshot={snapshot}
        requestError={requestError}
        api={effectiveApi}
        onRetry={() => void retry()}
        onRefresh={() => void refreshRuntime()}
        onSelectDistro={(d) => void selectDistro(d)}
      />
    </main>
  );
}
