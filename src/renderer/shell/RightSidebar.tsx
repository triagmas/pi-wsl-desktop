/**
 * Right details sidebar (D2): адаптер реального tool-state сессии поверх
 * одобренного ui/DetailsPanel. Панель размещает AppFrame (слот details);
 * здесь — шапка (заголовок + сворачивание) и тело (статус, инструменты,
 * сводка). Файлы/диффы не выдумываются: M1-события их не несут, секция
 * рендерится только при реальном наличии данных (честное отсутствие).
 */
import type { ChatTool } from '../useChat';
import { DetailsHeader, DetailsPanel, type DetailsCheck } from '../ui/DetailsPanel';
import { useResizeHandle } from './useResizeHandle';

export interface RightSidebarProps {
  tools: ChatTool[];
  streaming: boolean;
  /** Заголовок действия — имя активной сессии (реальный источник). */
  title?: string;
}

const RIGHT_MIN = 240;
const RIGHT_MAX = 560;

export function RightSidebarHead({ onClose }: { onClose: () => void }) {
  return (
    <DetailsHeader title="Детали действия" collapseTestId="close-details" onCollapse={onClose} />
  );
}

/**
 * Handle изменения ширины правой панели: рендерится в AppFrame-слоте
 * details.handle (прямой потомок <aside>, вне скролля тела) и живёт отдельно
 * от контента — тянется мышью и клавиатурой, фиксирует width один раз.
 */
export function RightSidebarResize({
  width,
  onWidthPreview,
  onWidthCommit,
}: {
  width: number;
  onWidthPreview?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
}) {
  const resize = useResizeHandle({
    axis: 'x',
    value: width,
    min: RIGHT_MIN,
    max: RIGHT_MAX,
    invert: true, // тянуть влево → панель шире
    onPreview: (w) => onWidthPreview?.(w),
    onCommit: (w) => onWidthCommit?.(w),
  });
  return (
    <div
      className="dl-resize dl-resize-x dl-resize-right"
      role="separator"
      aria-label="Ширина правой панели"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={RIGHT_MIN}
      aria-valuemax={RIGHT_MAX}
      tabIndex={0}
      data-testid="resize-right"
      onMouseDown={resize.onMouseDown}
      onKeyDown={resize.onKeyDown}
    />
  );
}

export function RightSidebar({ tools, streaming, title }: RightSidebarProps) {
  const doneCount = tools.filter((t) => t.done && !t.error).length;
  const errorCount = tools.filter((t) => t.error).length;

  const pill = streaming
    ? 'Выполняется…'
    : tools.length === 0
      ? 'Действий пока нет'
      : errorCount > 0
        ? `Ошибок: ${errorCount}`
        : 'Выполнено';

  const checks: DetailsCheck[] = tools.map((t) => ({
    id: t.id,
    text: t.error
      ? `${t.name} — ошибка`
      : t.done
        ? `${t.name} — готово`
        : `${t.name} — выполняется`,
    state: t.error ? 'error' : t.done ? 'done' : 'running',
  }));

  return (
    <div className="dl-details-adapter" data-testid="right-sidebar">
      <section aria-label="Обзор" data-testid="details-body">
        <DetailsPanel
          tabs={[]}
          pill={pill}
          title={title ?? 'Детали действия'}
          checksLabel="Инструменты"
          checks={checks}
          footer={`${tools.length} инстр. · ${doneCount} готово`}
        />
        {tools.length === 0 && (
          <p className="muted dl-details-empty" data-testid="details-empty">
            Инструменты появятся по мере работы Pi — здесь реальные события текущей сессии.
          </p>
        )}
      </section>
    </div>
  );
}
