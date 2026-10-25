/**
 * Terminal dock (D2): отдельная НИЖНЯЯ область центральной колонки —
 * скрываемая (тумблер в статус-баре и в шапке дока) и изменяемая по высоте
 * (handle: мышь + клавиатура, 120..600, persist appearance).
 *
 * Честность: реального PTY-контракта в Bridge/main/preload НЕТ (grep pty —
 * 0 совпадений), поэтому слот остаётся пустым (data-testid="terminal-slot",
 * без единой фиктивной строки), а шапка объясняет это пользователю.
 * Док не блокирует чат: он появляется/скрывается независимо от потока.
 */
import { useResizeHandle } from './useResizeHandle';

export interface TerminalSlotProps {
  /** Высота дока в px (stored + preview), persisted appearance.layout.terminalSlotHeight. */
  height: number;
  visible: boolean;
  onToggle: () => void;
  onHeightPreview?: (height: number) => void;
  onHeightCommit?: (height: number) => void;
}

const TERM_MIN = 120;
const TERM_MAX = 600;

export function TerminalSlot({ height, visible, onToggle, onHeightPreview, onHeightCommit }: TerminalSlotProps) {
  const resize = useResizeHandle({
    axis: 'y',
    value: height,
    min: TERM_MIN,
    max: TERM_MAX,
    invert: true, // тянуть край вниз → док ниже
    onPreview: (h) => onHeightPreview?.(h),
    onCommit: (h) => onHeightCommit?.(h),
  });

  if (!visible) return null;

  return (
    <div className="dl-term-dock" data-testid="terminal-dock" style={{ height: `${height}px` }}>
      <div className="dl-term-head" data-testid="terminal-dock-head">
        <button
          type="button"
          className="dl-btn-ghost dl-term-toggle"
          data-testid="terminal-dock-toggle"
          aria-expanded
          title="Скрыть терминал"
          onClick={onToggle}
        >
          <span aria-hidden="true">⌄</span> Терминал
        </button>
        <span className="dl-term-note muted">
          Реальный PTY подключается в UI-B — строк терминала пока нет
        </span>
        <div
          className="dl-resize dl-resize-y dl-resize-term"
          role="separator"
          aria-label="Высота терминала"
          aria-orientation="horizontal"
          aria-valuenow={height}
          aria-valuemin={TERM_MIN}
          aria-valuemax={TERM_MAX}
          tabIndex={0}
          data-testid="terminal-dock-resize"
          onMouseDown={resize.onMouseDown}
          onKeyDown={resize.onKeyDown}
        />
      </div>
      {/* Инертный слот: пусто, пока Bridge не отдаст настоящий PTY (UI-B). */}
      <div data-testid="terminal-slot" className="terminal-slot" aria-hidden="true" />
    </div>
  );
}
