/**
 * UI21 Interactive Corrective R02 — RED→GREEN для клавиатурных примитивов.
 * До фикса: overlayA11y отсутствовал, Select/Menu/Dialog не закрывались по
 * Escape и не управлялись стрелками (см. Playwright recon).
 */
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { edgeIndex, nextIndex, useOverlayDismiss } from '../../src/renderer/ui/overlayA11y';

describe('overlayA11y: roving index', () => {
  it('cycles down and up with wrap-around', () => {
    expect(nextIndex(0, 3, 1)).toBe(1);
    expect(nextIndex(2, 3, 1)).toBe(0);
    expect(nextIndex(0, 3, -1)).toBe(2);
  });

  it('starts from the first item when nothing is active', () => {
    expect(nextIndex(-1, 3, 1)).toBe(0);
    // ArrowUp with no active item lands on the last one, not on a negative index.
    expect(nextIndex(-1, 3, -1)).toBe(2);
  });

  it('is total for empty and single-item collections', () => {
    expect(nextIndex(0, 0, 1)).toBe(-1);
    expect(nextIndex(0, 1, 1)).toBe(0);
    expect(nextIndex(0, 1, -1)).toBe(0);
  });

  it('resolves Home/End edges', () => {
    expect(edgeIndex(4, 'first')).toBe(0);
    expect(edgeIndex(4, 'last')).toBe(3);
    expect(edgeIndex(0, 'last')).toBe(-1);
  });
});

/**
 * Поведение самого хука, а не только арифметика индексов: закрытие по Escape с
 * возвратом фокуса, клик вне области, исключённые триггеры, снятие слушателей.
 */
function Overlay({ ignoreSelector, onDismissSpy }: { ignoreSelector?: string; onDismissSpy?: () => void }) {
  const [open, setOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onDismiss = vi.fn(() => {
    onDismissSpy?.();
    setOpen(false);
  });
  useOverlayDismiss({ open, rootRef, onDismiss, returnFocusRef: triggerRef, ignoreSelector });
  return (
    <div>
      <button type="button" ref={triggerRef}>
        trigger
      </button>
      <button type="button" data-outside="1">
        outside
      </button>
      <div ref={rootRef} data-testid="overlay">
        {open ? <button type="button">inside</button> : null}
      </div>
    </div>
  );
}

describe('overlayA11y: dismiss behaviour', () => {
  it('closes on Escape and returns focus to the trigger', () => {
    render(<Overlay />);
    expect(screen.getByTestId('overlay')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('overlay')).toBeEmptyDOMElement();
    expect(document.activeElement).toBe(screen.getByText('trigger'));
  });

  it('ignores pointer-down inside the overlay and closes outside', () => {
    render(<Overlay />);
    fireEvent.mouseDown(screen.getByText('inside'));
    expect(screen.getByTestId('overlay')).not.toBeEmptyDOMElement();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.getByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('lets the trigger handle its own click when it is excluded', () => {
    render(<Overlay ignoreSelector="[data-outside]" />);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.getByTestId('overlay')).not.toBeEmptyDOMElement();
  });

  it('stops listening once the overlay has closed', () => {
    // Закрываем кликом вне: open → false, слушатели снимаются, повторный Escape
    // уже не должен вызывать dismiss.
    const spy = vi.fn();
    render(<Overlay onDismissSpy={spy} />);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('removes its document listeners on unmount', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Overlay />);
    unmount();
    const added = add.mock.calls.filter(([type]) => type === 'keydown').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown').length;
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
    add.mockRestore();
    remove.mockRestore();
  });
});
