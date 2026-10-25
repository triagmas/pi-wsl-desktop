/**
 * Global status bar (D2): презентация одобренного ui/StatusBar поверх
 * РЕАЛЬНЫХ данных подключения (phase/distro из живого snapshot).
 * Справа — явно помеченные Windows CPU/RAM: значения «—», выдумывать
 * метрики запрещено (UI-B принесёт реальный источник). Кнопка терминала —
 * тумблер нижнего дока (aria-pressed), а не декоративная disabled-кнопка.
 */
import { StatusBar as DesignStatusBar } from '../ui/StatusBar';

export interface StatusBarProps {
  phase: string;
  distro: string | null;
  /** Состояние нижнего терминального дока (aria-pressed кнопки). */
  terminalVisible: boolean;
  onTerminalToggle: () => void;
}

function connectionLabel(phase: string): { text: string; kind: 'ok' | 'wait' | 'bad' } {
  if (phase === 'ready') return { text: 'Pi подключён', kind: 'ok' };
  if (phase === 'error') return { text: 'Ошибка подключения', kind: 'bad' };
  return { text: 'Подключение…', kind: 'wait' };
}

export function StatusBar({ phase, distro, terminalVisible, onTerminalToggle }: StatusBarProps) {
  const conn = connectionLabel(phase);
  return (
    <div data-testid="status-bar" className="dl-status-inner">
      <DesignStatusBar
        connection={{ label: conn.text, dot: conn.kind === 'ok' }}
        distro={`${distro ?? '—'} · WSL`}
        right={[
          { id: 'os', text: 'Windows', mute: true },
          { id: 'cpu', text: 'CPU —', mute: true },
          { id: 'ram', text: 'RAM —', mute: true },
        ]}
        terminalLabel="Терминал"
        terminalActive={terminalVisible}
        onTerminalToggle={onTerminalToggle}
      />
    </div>
  );
}
