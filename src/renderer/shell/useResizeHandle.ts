/**
 * Resize handle logic (D2): mouse drag + keyboard for panel edges.
 *
 * Десктоп-only приложение (Electron), поэтому используются mouse-события —
 * они одинаково работают в Chromium и в jsdom-тестах; клавиатура (стрелки)
 * обязательна для доступности и покрыта теми же колбэками.
 * Живой предпросмотр (onPreview) не пишет persistence; onCommit — один вызов
 * на жест (мышь) или на нажатие (клавиши).
 */
import { useCallback, useEffect, useRef } from 'react';

export interface UseResizeOptions {
  axis: 'x' | 'y';
  /** Текущее значение (предпросмотр уже может отличаться от stored). */
  value: number;
  min: number;
  max: number;
  /** true → тянуть «вправо/вниз» уменьшает (handle слева/сверху контента). */
  invert?: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  /** Шаг клавиатуры, px (default 16). */
  step?: number;
}

export interface ResizeHandleProps {
  onMouseDown: (event: { clientX: number; clientY: number; preventDefault: () => void }) => void;
  onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function useResizeHandle({
  axis,
  value,
  min,
  max,
  invert = false,
  onPreview,
  onCommit,
  step = 16,
}: UseResizeOptions): ResizeHandleProps {
  const startRef = useRef<{ pointer: number; value: number } | null>(null);
  const lastRef = useRef<number>(value);
  // синхронизация вне рендера (react-hooks/refs): committed-значение — источник
  // для mousedown; во время drag lastRef живёт от onMove.
  useEffect(() => {
    lastRef.current = value;
  }, [value]);

  const onMouseDown = useCallback(
    (event: { clientX: number; clientY: number; preventDefault: () => void }) => {
      event.preventDefault();
      startRef.current = {
        pointer: axis === 'x' ? event.clientX : event.clientY,
        value: lastRef.current,
      };
    },
    [axis],
  );

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const start = startRef.current;
      if (!start) return;
      const pointer = axis === 'x' ? event.clientX : event.clientY;
      const delta = (pointer - start.pointer) * (invert ? -1 : 1);
      const next = clamp(start.value + delta, min, max);
      lastRef.current = next;
      onPreview(next);
    };
    const onUp = (): void => {
      const start = startRef.current;
      if (!start) return;
      startRef.current = null;
      onCommit(lastRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [axis, invert, min, max, onPreview, onCommit]);

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      const deltaByKey: Record<string, number> =
        axis === 'x'
          ? { ArrowRight: step, ArrowLeft: -step }
          : { ArrowUp: step, ArrowDown: -step };
      const delta = deltaByKey[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      const next = clamp(value + delta, min, max);
      lastRef.current = next;
      onPreview(next);
      onCommit(next);
    },
    [axis, value, min, max, step, onPreview, onCommit],
  );

  return { onMouseDown, onKeyDown };
}
