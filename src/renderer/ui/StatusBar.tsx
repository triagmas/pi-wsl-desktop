/**
 * Design Lab — глобальный статус-бар (Issue #21, D1; ref5).
 * Только представление. Слева — подключение/дистрибутив, справа — фикстурные
 * элементы ( OS / CPU / RAM / терминал ). Реальные метрики UI-B в лабораторию
 * не подключаются: значения в fixtures.ts помечены как DEMO.
 */
import { Fragment, type ReactNode } from 'react';
import { IconTerminalGlyph } from './icons';

export interface StatusItem {
  id: string;
  text: string;
  icon?: ReactNode;
  mute?: boolean;
}

export interface StatusBarProps {
  connection: { dot?: boolean; label: string };
  distro?: string;
  right?: StatusItem[];
  terminalLabel?: string;
  /** board (D1-b): живой переключатель; без обработчика кнопка статична (ref5). */
  onTerminalToggle?: () => void;
  /** board: активное состояние кнопки терминала (рендерится только с обработчиком). */
  terminalActive?: boolean;
}

export function StatusBar({
  connection,
  distro,
  right = [],
  terminalLabel,
  onTerminalToggle,
  terminalActive = false,
}: StatusBarProps) {
  return (
    <>
      <div className="dl-status-group">
        <span className="dl-status-item">
          {connection.dot !== false ? <span className="dl-status-dot" aria-hidden="true" /> : null}
          {connection.label}
        </span>
        {distro ? (
          <>
            <span className="dl-status-sep" aria-hidden="true" />
            <span className="dl-status-mute">{distro}</span>
          </>
        ) : null}
      </div>
      <div className="dl-status-group">
        {right.map((item, i) => (
          <Fragment key={item.id}>
            {i > 0 ? <span className="dl-status-sep" aria-hidden="true" /> : null}
            <span className={`dl-status-item${item.mute ? ' dl-status-mute' : ''}`}>
              {item.icon ? (
                <span className="dl-status-ico" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              {item.text}
            </span>
          </Fragment>
        ))}
        {terminalLabel ? (
          <>
            <span className="dl-status-sep" aria-hidden="true" />
            <button
              type="button"
              className="dl-status-term"
              onClick={onTerminalToggle}
              aria-pressed={onTerminalToggle ? terminalActive : undefined}
            >
              <IconTerminalGlyph size={16} />
              {terminalLabel}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}
