/**
 * Global status bar (Issue #21 §6): fixed 28px full-width line. Left — real
 * Pi connection state and the selected Ubuntu/WSL distro from the live
 * snapshot. Right — explicitly labeled Windows host metrics; in UI-A there is
 * no metrics source yet, so values render as «—», never invented numbers
 * (real CPU/RAM typed IPC arrives with UI-B), plus the terminal entry point,
 * honestly disabled until the real PTY ships.
 */
export interface StatusBarProps {
  phase: string;
  distro: string | null;
  onOpenSettings: () => void;
}

function connectionLabel(phase: string): { text: string; kind: 'ok' | 'wait' | 'bad' } {
  if (phase === 'ready') return { text: 'Pi подключён', kind: 'ok' };
  if (phase === 'error') return { text: 'Ошибка подключения', kind: 'bad' };
  return { text: 'Подключение…', kind: 'wait' };
}

export function StatusBar({ phase, distro, onOpenSettings }: StatusBarProps) {
  const conn = connectionLabel(phase);
  return (
    <footer data-testid="status-bar" className="status-bar" aria-label="Статус подключения">
      <div className="status-left">
        <span className="status-item" data-testid="status-connection" data-kind={conn.kind}>
          <span className={`conn-dot conn-${conn.kind}`} aria-hidden="true" />
          {conn.text}
        </span>
        <span className="status-sep" aria-hidden="true">
          |
        </span>
        <span className="status-item" data-testid="status-distro">
          {distro ?? '—'} · WSL
        </span>
      </div>
      <div className="status-right">
        <span className="status-item status-metrics-label">Windows</span>
        <span className="status-item" data-testid="status-cpu">
          CPU <span aria-label="недоступно">—</span>
        </span>
        <span className="status-item" data-testid="status-ram">
          RAM <span aria-label="недоступно">—</span>
        </span>
        <button
          type="button"
          data-testid="status-terminal-btn"
          className="status-terminal"
          disabled
          title="Терминал появится в следующем этапе (UI-B)"
          onClick={onOpenSettings}
        >
          <span aria-hidden="true">&gt;_</span> Терминал
        </button>
      </div>
    </footer>
  );
}
