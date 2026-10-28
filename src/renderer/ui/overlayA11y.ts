/**
 * UI21 Interactive Corrective R02 — общие клавиатурные/фокусные примитивы для
 * всплывающих слоёв (Select / ActionMenu / Dialog / chip-меню).
 *
 * Только поведение и ARIA: ни цвета, ни геометрия утверждённых эталонов не
 * затрагиваются. Компоненты остаются чистыми (state + один эффект).
 */
import { useEffect, type RefObject } from 'react';

/** Следующий индекс по кругу: ArrowDown/ArrowUp в listbox/menu. */
export function nextIndex(current: number, length: number, delta: number): number {
  if (length <= 0) return -1;
  const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (base + delta + length) % length;
}

/** Home/End. */
export function edgeIndex(length: number, edge: 'first' | 'last'): number {
  if (length <= 0) return -1;
  return edge === 'first' ? 0 : length - 1;
}

/**
 * Закрытие по Escape (с возвратом фокуса на триггер) и по клику вне области.
 * Обработчики живут только пока слой открыт.
 */
export function useOverlayDismiss({
  open,
  rootRef,
  onDismiss,
  returnFocusRef,
  ignoreSelector,
}: {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Триггеры, клик по которым обрабатывает сам компонент (иначе toggle
   * закрылся бы на mousedown и тут же открылся на click). */
  ignoreSelector?: string;
}): void {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const target = event.target as Node;
      const root = rootRef.current;
      if (root && root.contains(target)) return;
      if (ignoreSelector && target instanceof Element && target.closest(ignoreSelector)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
      returnFocusRef?.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, rootRef, onDismiss, returnFocusRef, ignoreSelector]);
}
