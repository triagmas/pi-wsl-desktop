/**
 * UI21 Interactive Corrective R02 — компонентные тесты ячеек Design Lab.
 * Проверяют именно поведение: фокус уходит в настоящую опцию listbox,
 * Escape возвращает фокус на триггер, inline-превью диалога не модально и не
 * забирает фокус при монтировании, модальность включается только действием.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { V5Body } from '../../src/renderer/ui/BoardCellsV5';

describe('Design Lab select (V5 "select")', () => {
  it('moves real focus into the listbox and returns it to the trigger', async () => {
    render(<V5Body id="select" />);
    const trigger = screen.getByRole('button', { name: /Ubuntu 24\.04/i });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    const list = await screen.findByRole('listbox', { name: 'Дистрибутив' });
    expect(list.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveAttribute('role', 'option');

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Debian 12');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Design Lab action menu (V5 "menu")', () => {
  it('opens with focus inside, navigates with arrows and closes on Escape', async () => {
    render(<V5Body id="menu" />);
    const trigger = screen.getByRole('button', { name: /Ещё/i });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    const menu = await screen.findByRole('menu');
    expect(menu.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Переименовать');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Design Lab dialog (V5 "modal")', () => {
  it('mounts as a non-modal preview without stealing focus', () => {
    render(<V5Body id="modal" />);
    const dialog = screen.getByRole('dialog', { name: 'Удалить сессию?' });
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog.contains(document.activeElement)).toBe(false);
  });

  it('becomes modal only after explicit activation', async () => {
    render(<V5Body id="modal" />);
    const dialog = screen.getByRole('dialog', { name: 'Удалить сессию?' });
    await userEvent.click(screen.getByText(/Сессия «логи от 12 октября»/));
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toHaveTextContent('Отмена');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent('Открыть снова');
  });

  it('closing from the preview returns focus to the reopen button', async () => {
    render(<V5Body id="modal" />);
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent('Открыть снова');
    // Явное повторное открытие (кнопка) включает модальный режим — это
    // единственный путь активации; закрытие из превью его не включало
    // (проверено выше: после закрытия aria-modal не выставлялся, фокус на кнопке).
    await userEvent.click(screen.getByRole('button', { name: 'Открыть снова' }));
    expect(screen.getByRole('dialog', { name: 'Удалить сессию?' })).toHaveAttribute('aria-modal', 'true');
  });
});
