/**
 * D3 — честный терминальный док поверх УТВЕРЖДЁННОЙ оболочки
 * ui/TerminalPane (owner #6398531407: «approved presentation shell with an
 * honest inert/empty state»). Компактная замена shell/TerminalSlot:
 * grip дока = resize-handle (мышь+клавиатура, 120..600, persist), тело несёт
 * честное уведомление об отсутствии PTY-контракта и пустой зарезервированный
 * слот — фиктивного вывода нет. Функция «скрыть док» — тумблер статус-бара.
 */
import { TerminalPane } from '../ui/TerminalPane';
import { useResizeHandle } from './useResizeHandle';

export interface TerminalDockProps {
  /** Высота дока (stored + preview), persisted appearance.layout.terminalSlotHeight. */
  height: number;
  onHeightPreview?: (height: number) => void;
  onHeightCommit?: (height: number) => void;
}

const TERM_MIN = 120;
const TERM_MAX = 600;

export function TerminalDock({ height, onHeightPreview, onHeightCommit }: TerminalDockProps) {
  const resize = useResizeHandle({
    axis: 'y',
    value: height,
    min: TERM_MIN,
    max: TERM_MAX,
    invert: true, // тянуть верхнюю границу вниз → док ниже (как drag мышью)
    onPreview: (h) => onHeightPreview?.(h),
    onCommit: (h) => onHeightCommit?.(h),
  });

  return (
    <TerminalPane
      height={height}
      testid={{ dock: 'terminal-dock', slot: 'terminal-slot' }}
      tabs={[{ id: 'main', label: 'Терминал' }]}
      lines={[]}
      grip={
        <div
          className="dl-grip dl-resize dl-resize-y dl-resize-term"
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
      }
      body={
        <span className="dl-term-note muted">
          Реальный PTY подключается в UI-B — строк терминала пока нет
        </span>
      }
    />
  );
}
