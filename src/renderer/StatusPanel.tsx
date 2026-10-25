import type { DesktopApi } from './api';
import type { RendererSnapshot } from './types';

export interface StatusPanelProps {
  snapshot: RendererSnapshot;
  requestError: string | null;
  api: DesktopApi | null;
  onRetry: () => void;
  onRefresh: () => void;
  onSelectDistro: (distro: string) => void;
}

export function phaseText(snapshot: RendererSnapshot): string {
  switch (snapshot.phase) {
    case 'idle':
      return 'Подключение…';
    case 'discovering':
      return 'Подключение… Поиск дистрибутива и Pi';
    case 'connecting':
      return 'Подключение… Запуск WSL Bridge';
    case 'backoff':
      return `Переподключение (попытка ${snapshot.attempt})…`;
    case 'ready':
      return 'Готово — мост установлен';
    case 'error':
      return 'Ошибка подключения';
  }
}

export function StatusPanel({ snapshot, requestError, api, onRetry, onRefresh, onSelectDistro }: StatusPanelProps) {
  const { runtime } = snapshot;
  const showSpinner = snapshot.phase !== 'error' && snapshot.phase !== 'ready';

  return (
    <section className="panel" aria-label="Состояние подключения">
      <header className={`panel-header phase-${snapshot.phase}`}>
        {showSpinner && <span data-testid="spinner" className="spinner" aria-hidden="true" />}
        <h2 data-testid="status-phase">{phaseText(snapshot)}</h2>
        <span data-testid="status-badge" className={`badge badge-${snapshot.phase}`}>
          {snapshot.phase}
        </span>
      </header>

      {snapshot.phase === 'error' && snapshot.lastError && (
        <div className="error-box" role="alert">
          <div>
            <strong data-testid="error-code">{snapshot.lastError.code}</strong>
            <span> — {snapshot.lastError.message}</span>
          </div>
          <button type="button" onClick={onRetry}>
            Повторить подключение
          </button>
        </div>
      )}

      {snapshot.distros && snapshot.distros.length > 0 && (
        <label className="distro-row">
          <span>Дистрибутив</span>
          <select
            data-testid="distro"
            value={snapshot.distro ?? snapshot.distros[0] ?? ''}
            onChange={(e) => onSelectDistro(e.target.value)}
          >
            {snapshot.distros.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}

      {snapshot.phase === 'ready' && (
        <dl className="runtime" data-testid="runtime">
          <div>
            <dt>Дистрибутив</dt>
            <dd>{runtime?.distro ?? snapshot.distro ?? '—'}</dd>
          </div>
          <div>
            <dt>Node.js</dt>
            <dd>{runtime?.node.version ?? '—'}</dd>
          </div>
          <div>
            <dt>Pi</dt>
            <dd>{runtime ? `${runtime.pi.version}${runtime.pi.rpcSupported ? '' : ' (без RPC)'}` : '—'}</dd>
          </div>
          <div>
            <dt>Агентный каталог</dt>
            <dd className="path">{runtime?.agentDir ?? '—'}</dd>
          </div>
          <button type="button" onClick={onRefresh}>
            Обновить данные
          </button>
        </dl>
      )}

      {requestError && (
        <div data-testid="request-error" className="request-error" role="status">
          {requestError}
        </div>
      )}

      {!api && snapshot.phase !== 'error' && (
        <div data-testid="request-error" className="request-error" role="status">
          Preload API unavailable
        </div>
      )}
    </section>
  );
}
