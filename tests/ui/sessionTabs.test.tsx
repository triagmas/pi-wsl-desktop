/**
 * UI21 C / L1: общий таб-переключатель сессии «История | Чат».
 * Один компонент на продукт (App.tsx) и Design Lab (AppScreenLab) —
 * единая композиция D3-решения владельца (#6398531407).
 * RED: компонент ещё не выделен.
 */
import { describe, expect, it, vi } from 'vitest';
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

  it('marks the active mode with the approved classes', () => {
    render(<SessionTabs mode="history" onChange={() => {}} />);
    expect(screen.getByTestId('tab-history').className).toContain('dl-session-tab-active');
    expect(screen.getByTestId('tab-chat').className).not.toContain('dl-session-tab-active');
    expect(screen.getByTestId('tab-history')).toHaveAttribute('aria-selected', 'true');
  });
});
