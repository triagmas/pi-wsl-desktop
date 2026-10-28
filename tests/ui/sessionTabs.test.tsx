/**
 * UI21 C / L1: общий таб-переключатель сессии «История | Чат».
 * Один компонент на продукт (App.tsx) и Design Lab (AppScreenLab) —
 * единая композиция D3-решения владельца (#6398531407).
 * RED: компонент ещё не выделен.
 */
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionTabs } from '../../src/renderer/ui/SessionTabs';

describe('ui/SessionTabs', () => {
  it('renders the approved tablist contract and reports mode changes', () => {
    const onChange = vi.fn();
    render(<SessionTabs mode="chat" onChange={onChange} />);

    const list = screen.getByRole('tablist', { name: 'Режим сессии' });
    expect(list).toBeInTheDocument();

    const history = screen.getByTestId('tab-history');
    const chat = screen.getByTestId('tab-chat');
    expect(history).toHaveAttribute('aria-selected', 'false');
    expect(chat).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(history);
    expect(onChange).toHaveBeenCalledWith('history');
    fireEvent.click(chat);
    expect(onChange).toHaveBeenCalledWith('chat');
  });

  it('exposes a roving tabindex: only the active tab is in the tab order', () => {
    render(<SessionTabs mode="chat" onChange={() => {}} />);
    expect(screen.getByTestId('tab-history')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('tab-chat')).toHaveAttribute('tabindex', '0');
  });

  it('moves selection with ArrowLeft/ArrowRight and Home/End', () => {
    // Последний вызов, а не «когда-либо вызывалось»: иначе no-op клавиша
    // проходила бы проверку за счёт предыдущего нажатия.
    const onChange = vi.fn();
    render(<SessionTabs mode="history" onChange={onChange} />);

    fireEvent.keyDown(screen.getByTestId('tab-history'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('chat');
    fireEvent.keyDown(screen.getByTestId('tab-history'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('chat');
    expect(onChange).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(screen.getByTestId('tab-chat'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('history');
    fireEvent.keyDown(screen.getByTestId('tab-chat'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('history');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('marks the active mode with the approved classes', () => {
    render(<SessionTabs mode="history" onChange={() => {}} />);
    expect(screen.getByTestId('tab-history').className).toContain('dl-session-tab-active');
    expect(screen.getByTestId('tab-chat').className).not.toContain('dl-session-tab-active');
    expect(screen.getByTestId('tab-history')).toHaveAttribute('aria-selected', 'true');
  });
});

/**
 * Stateful: компонент-обёртка держит выбор, поэтому проверяется и переход
 * aria-selected, и фокус — а не только факт вызова колбэка.
 */
function Controlled({ initial = 'history' }: { initial?: 'history' | 'chat' }) {
  const [mode, setMode] = useState<'history' | 'chat'>(initial);
  return <SessionTabs mode={mode} onChange={setMode} />;
}

describe('ui/SessionTabs: клавиатура', () => {
  it('ArrowRight selects the next tab and moves focus, ArrowLeft returns', () => {
    render(<Controlled />);
    const history = screen.getByTestId('tab-history');
    history.focus();
    fireEvent.keyDown(history, { key: 'ArrowRight' });
    const chat = screen.getByTestId('tab-chat');
    expect(chat).toHaveAttribute('aria-selected', 'true');
    expect(history).toHaveAttribute('aria-selected', 'false');
    expect(document.activeElement).toBe(chat);
    expect(chat).toHaveAttribute('tabindex', '0');
    expect(history).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(chat, { key: 'ArrowLeft' });
    expect(history).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(history);
  });

  it('Home and End jump to the first and last tab', () => {
    render(<Controlled initial="chat" />);
    const chat = screen.getByTestId('tab-chat');
    chat.focus();
    fireEvent.keyDown(chat, { key: 'Home' });
    expect(screen.getByTestId('tab-history')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByTestId('tab-history'), { key: 'End' });
    expect(screen.getByTestId('tab-chat')).toHaveAttribute('aria-selected', 'true');
  });
});
