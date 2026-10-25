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
  /** D2: data-testid строки (продуктовые контракты/е2е). */
  testid?: string;
  /** D2: тултип кнопки (по умолчанию = label). */
  title?: string;
}

export interface RailProps {
  top: RailItem[];
  bottom: RailItem[];
  /** Фикстурный тултип у кнопки-тумблера (ref1). */
  tooltip?: string;
  connectionDot?: boolean;
  /** D2: обработчик клика по пункту (design-lab передаёт — визуал не меняется). */
  onItemClick?: (id: string) => void;
}

export function Rail({ top, bottom, tooltip, connectionDot = true, onItemClick }: RailProps) {
  return (
    <nav className="dl-rail" aria-label="Быстрая навигация">
      {top.map((item) => (
        <button
          key={item.id}
          type="button"
          className="dl-rail-btn"
          aria-label={item.label}
          title={item.title ?? item.label}
          data-testid={item.testid}
          onClick={() => onItemClick?.(item.id)}
        >
          {item.icon}
        </button>
      ))}
      <div className="dl-rail-spacer" />
      {bottom.map((item) => (
        <button
          key={item.id}
          type="button"
          className="dl-rail-btn"
          aria-label={item.label}
          title={item.title ?? item.label}
          data-testid={item.testid}
          onClick={() => onItemClick?.(item.id)}
        >
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
