/**
 * Design Lab — терминал строго под композером (Issue #21, D1; ref5).
 * Только представление: grip, вкладки и статичные строки фикстуры.
 * Реальный PTY/терминал — UI-B и НЕ начинается в D1; строки — иллюстрация,
 * ANSI-цвета через токены --pw-terminal-*.
 */
import type { ReactNode } from 'react';
import { IconClose, IconExpandArrows, IconPlus, IconTerminalGlyph } from './icons';

export interface TerminalTab {
  id: string;
  label: string;
  /** иконка слева от подписи (первая вкладка — «>_»). */
  icon?: ReactNode;
  active?: boolean;
  /** крестик справа (вкладка сессии «Ubuntu · bash ×»). */
  closable?: boolean;
}

export interface TerminalPaneProps {
  tabs: TerminalTab[];
  /** Строки с классами t-green / t-blue / t-muted (см. components.css). */
  lines: ReactNode[];
}

export function TerminalPane({ tabs, lines }: TerminalPaneProps) {
  return (
    <section className="dl-terminal" aria-label="Терминал (фикстура Design Lab)">
      <div className="dl-grip" aria-hidden="true" />
      <div className="dl-term-tabs">
        {tabs.map((tab) => (
          <span key={tab.id} className={`dl-term-tab${tab.active ? ' dl-term-tab-active' : ''}`}>
            {tab.icon}
            {tab.label}
            {tab.closable ? (
              <span className="dl-term-tab-close" aria-hidden="true">
                <IconClose size={15} />
              </span>
            ) : null}
          </span>
        ))}
        <button type="button" className="dl-term-add" aria-label="Новая вкладка">
          <IconPlus size={17} />
        </button>
        <div className="dl-term-actions">
          <button type="button" className="dl-term-iconbtn" aria-label="Развернуть терминал">
            <IconExpandArrows size={19} />
          </button>
          <button type="button" className="dl-term-iconbtn" aria-label="Закрыть терминал">
            <IconClose size={19} />
          </button>
        </div>
      </div>
      <div className="dl-term-body">
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </section>
  );
}

export const terminalGlyph = <IconTerminalGlyph size={17} />;
