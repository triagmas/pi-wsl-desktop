/**
 * Design Lab — свёрнутый rail (Issue #21, D1, состояния ref1/ref5).
 * Только представление; тултип «Показать проекты» показывается фикстурой
 * (hover-состояние зафиксировано в эталоне ref1).
 */
import type { ReactNode } from 'react';

export interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface RailProps {
  top: RailItem[];
  bottom: RailItem[];
  /** Фикстурный тултип у кнопки-тумблера (ref1). */
  tooltip?: string;
  connectionDot?: boolean;
}

export function Rail({ top, bottom, tooltip, connectionDot = true }: RailProps) {
  return (
    <nav className="dl-rail" aria-label="Быстрая навигация">
      {top.map((item) => (
        <button key={item.id} type="button" className="dl-rail-btn" aria-label={item.label}>
          {item.icon}
        </button>
      ))}
      <div className="dl-rail-spacer" />
      {bottom.map((item) => (
        <button key={item.id} type="button" className="dl-rail-btn" aria-label={item.label}>
          {item.icon}
        </button>
      ))}
      {connectionDot ? <span className="dl-rail-dot" aria-label="Pi подключён" /> : null}
      {tooltip ? (
        <span className="dl-rail-tooltip" role="tooltip" style={{ top: '-31px' }}>
          {tooltip}
        </span>
      ) : null}
    </nav>
  );
}
