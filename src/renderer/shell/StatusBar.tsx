/**
 * Global status bar (D2): презентация одобренного ui/StatusBar поверх
 * РЕАЛЬНЫХ данных подключения (phase/distro из живого snapshot).
 * Справа — явно помеченные Windows CPU/RAM: значения «—», выдумывать
 * метрики запрещено (UI-B принесёт реальный источник). Кнопка терминала —
 * тумблер нижнего дока (aria-pressed), а не декоративная disabled-кнопка.
 */
import { StatusBar as DesignStatusBar } from '../ui/StatusBar';
import { formatMetrics, EMPTY_METRICS, type MetricsSample } from '../../shared/terminalMetrics';

export interface StatusBarProps {
  phase: string;
  distro: string | null;
  /** Состояние нижнего терминального дока (aria-pressed кнопки). */
  terminalVisible: boolean;
  onTerminalToggle: () => void;
  /** D2: проброс продуктовых testid (e2e-контракты UI-A/M1) на элементы. */
  testids?: { connection?: string; distro?: string };
  /** UI-B: реальные метрики Windows-хоста; undefined — честные «—». */
  metrics?: MetricsSample;
}

function connectionLabel(phase: string): { text: string; kind: 'ok' | 'wait' | 'bad' } {
  if (phase === 'ready') return { text: 'Pi подключён', kind: 'ok' };
  if (phase === 'error') return { text: 'Ошибка подключения', kind: 'bad' };
  return { text: 'Подключение…', kind: 'wait' };
}

export function StatusBar({
  phase,
  distro,
  terminalVisible,
  onTerminalToggle,
  testids,
  metrics = EMPTY_METRICS,
}: StatusBarProps) {
  const conn = connectionLabel(phase);
  const metricsText = formatMetrics(metrics);
  return (
    <div data-testid="status-bar" className="dl-status-inner status-bar">
      <DesignStatusBar
        connection={{ label: conn.text, dot: conn.kind === 'ok', testid: testids?.connection }}
        distro={`${distro ?? '—'} · WSL`}
        distroTestId={testids?.distro}
        right={[
          { id: 'status-os', text: 'Windows', mute: true },
          { id: 'status-cpu', text: `CPU ${metricsText.cpu}`, mute: metrics.cpuPercent === null },
          { id: 'status-ram', text: `RAM ${metricsText.ram}`, mute: metrics.memTotalBytes === null },
        ]}
        terminalLabel="Терминал"
        terminalTestId="status-terminal-btn"
        terminalActive={terminalVisible}
        onTerminalToggle={onTerminalToggle}
      />
    </div>
  );
}
