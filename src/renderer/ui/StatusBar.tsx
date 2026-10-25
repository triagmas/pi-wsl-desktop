/**
 * Design Lab — глобальный статус-бар (Issue #21, D1; ref5).
 * Только представление. Слева — подключение/дистрибутив, справа — фикстурные
 * элементы ( OS / CPU / RAM / терминал ). Реальные метрики UI-B в лабораторию
 * не подключаются: значения в fixtures.ts помечены как DEMO.
 */
import { Fragment, type ReactNode } from 'react';
import { IconGitBranch, IconTerminalGlyph } from './icons';

export interface StatusItem {
  id: string;
  text: string;
  icon?: ReactNode;
  mute?: boolean;
}

export interface StatusBarProps {
  /** app (D1-этап 2): ветка слева первой (эталон 01-chat-review-terminal «⑂ main»). */
  branch?: string;
  connection: { dot?: boolean; label: string; testid?: string };
  distro?: string;
  /** D2: продуктовый testid на строке дистрибутива (e2e UI-A). */
  distroTestId?: string;
  right?: StatusItem[];
  terminalLabel?: string;
  /** board (D1-b): живой переключатель; без обработчика кнопка статична (ref5). */
  onTerminalToggle?: () => void;
  /** board: активное состояние кнопки терминала (рендерится только с обработчиком). */
  terminalActive?: boolean;
  /** D2: продуктовый testid на кнопке терминала (e2e UI-A). */
  terminalTestId?: string;
}

export function StatusBar({
  branch,
  connection,
  distro,
  distroTestId,
  right = [],
  terminalLabel,
  onTerminalToggle,
  terminalActive = false,
  terminalTestId,
}: StatusBarProps) {
  return (
    <>
      <div className="dl-status-group">
        {branch ? (
          <span className="dl-status-item">
            <span className="dl-status-ico" aria-hidden="true">
              <IconGitBranch size={15} />
            </span>
            {branch}
          </span>
        ) : null}
        <span className="dl-status-item" data-testid={connection.testid ?? undefined}>
          {connection.dot !== false ? <span className="dl-status-dot" aria-hidden="true" /> : null}
          {connection.label}
        </span>
        {distro ? (
          <>
            <span className="dl-status-sep" aria-hidden="true" />
            <span className="dl-status-mute" data-testid={distroTestId ?? undefined}>
              {distro}
            </span>
          </>
        ) : null}
      </div>
      <div className="dl-status-group">
        {right.map((item, i) => (
          <Fragment key={item.id}>
            {i > 0 ? <span className="dl-status-sep" aria-hidden="true" /> : null}
            <span
              className={`dl-status-item${item.mute ? ' dl-status-mute' : ''}`}
              data-testid={item.id}
            >
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
              data-testid={terminalTestId ?? undefined}
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
