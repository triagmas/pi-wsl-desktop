/**
 * Design Lab — терминал строго под композером (Issue #21, D1; ref5).
 * Только представление: grip, вкладки и строки фикстуры; в board (D1-b) вкладки
 * и «+» — интерактивные (они-опциональны, без обработчиков контракт не меняется).
 * Реальный PTY/терминал — UI-B и НЕ начинается в D1; строки — иллюстрация,
 * ANSI-цвета через токены --pw-terminal-*.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
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
  /** D3 (Electron): фиксированная высота дока (persisted layout); без пропа —
   * высота как в design-lab (CSS/контент). */
  height?: number;
  /** D3 (Electron): замена декоративного grip на resize-handle (слот honest
   * capability); без пропа — прежний grip, визуал лабы не меняется. */
  grip?: ReactNode;
  /** D3 (Electron): дополнительное тело дока (честная пустая строка PTY +
   * зарезервированный пустой slot) рядом с lines. */
  body?: ReactNode;
  /** D3 (Electron): продуктовые testid (terminal-dock / terminal-slot). */
  testid?: { dock?: string; slot?: string };
  /** UI-B: живой PTY — тело дока перестаёт быть текстовым блоком-заглушкой. */
  live?: boolean;
  /** board: переключение вкладки (без обработчика вкладки статичны). */
  onSelectTab?: (id: string) => void;
  /** board: кнопка «+» (без обработчика не рендерится — контракт ref5 сохранён). */
  onAddTab?: () => void;
  /** board: закрыть вкладку (крестик кликабелен только при обработчике). */
  onCloseTab?: (id: string) => void;
  /**
   * R01 (#6559283775): реальные действия дока. Без обработчиков (Design Lab
   * board / демо-лист) кнопки остаются декоративными, как раньше.
   */
  onToggleExpand?: () => void;
  expanded?: boolean;
  onClose?: () => void;
}

export function TerminalPane({
  tabs,
  lines,
  height,
  grip,
  body,
  testid,
  live = false,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onToggleExpand,
  expanded = false,
  onClose,
}: TerminalPaneProps) {
  return (
    <section
      className="dl-terminal"
      aria-label="Терминал"
      data-testid={testid?.dock}
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      {grip ?? <div className="dl-grip" aria-hidden="true" />}
      <div className="dl-term-tabs" role={onSelectTab ? 'tablist' : undefined}>
        {tabs.map((tab) => {
          const TabTag = onSelectTab ? 'button' : 'span';
          return (
            <TabTag
              key={tab.id}
              {...(onSelectTab
                ? {
                    type: 'button' as const,
                    role: 'tab' as const,
                    'aria-selected': Boolean(tab.active),
                    onClick: () => onSelectTab(tab.id),
                  }
                : {})}
              className={`dl-term-tab${tab.active ? ' dl-term-tab-active' : ''}`}
            >
              {tab.icon}
              {tab.label}
              {tab.closable ? (
                <span
                  className="dl-term-tab-close"
                  {...(onCloseTab
                    ? {
                        role: 'button' as const,
                        tabIndex: 0,
                        'aria-label': `Закрыть вкладку ${tab.label}`,
                        onClick: (e: MouseEvent) => {
                          e.stopPropagation();
                          onCloseTab(tab.id);
                        },
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          e.stopPropagation();
                          onCloseTab(tab.id);
                        },
                      }
                    : { 'aria-hidden': true as const })}
                >
                  <IconClose size={15} />
                </span>
              ) : null}
            </TabTag>
          );
        })}
        {onAddTab ? (
          <button
            type="button"
            className="dl-term-add"
            aria-label="Новая вкладка"
            data-testid="terminal-new-tab"
            onClick={onAddTab}
          >
            <IconPlus size={17} />
          </button>
        ) : null}
        <div className="dl-term-actions">
          <button
            type="button"
            className="dl-term-iconbtn"
            aria-label={expanded ? 'Вернуть прежнюю высоту' : 'Развернуть терминал'}
            aria-pressed={onToggleExpand ? expanded : undefined}
            data-testid={onToggleExpand ? 'terminal-expand' : undefined}
            onClick={onToggleExpand}
          >
            <IconExpandArrows size={19} />
          </button>
          <button
            type="button"
            className="dl-term-iconbtn"
            aria-label="Закрыть терминал"
            data-testid={onClose ? 'terminal-close' : undefined}
            onClick={onClose}
          >
            <IconClose size={19} />
          </button>
        </div>
      </div>
      <div className={live ? 'dl-term-body dl-term-body-live' : 'dl-term-body'}>
        {body}
        {testid?.slot ? <div data-testid={testid.slot} className="terminal-slot" aria-hidden="true" /> : null}
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </section>
  );
}

export const terminalGlyph = <IconTerminalGlyph size={17} />;
