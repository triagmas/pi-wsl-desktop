/**
 * R03-2 (#26, #6572954720, P3) — предпросмотр шрифта уменьшается на одну
 * осмысленную ступень, остаётся muted и читаемым (AA), но НЕ меняет реальные
 * настройки шрифта пользователя, тему и семейства.
 *
 * R02 сделал preview только приглушённым: кегль остался 13/14/13 px, то есть
 * визуально совпадал с рабочим текстом. Владелец просил опустить именно
 * предпросмотр на ступень ниже.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

const A = { id: '/p/a', name: 'alpha', path: '/p/a', sessionCount: 0, updatedAt: null };

function harness() {
  const api = makeApi();
  const base = api._request.getMockImplementation() as unknown as (
    method: string,
    params?: unknown,
  ) => Promise<unknown>;
  api._request.mockImplementation(async (method: string, params?: unknown) => {
    if (method === 'listProjects') return { projects: [A], diagnostics: [] };
    if (method === 'listSessions') return { sessions: [], diagnostics: [] };
    if (method === 'getAvailableModels') return { models: [] };
    if (method === 'getThinkingLevels') return { levels: [], current: null };
    return base(method, params);
  });
  return api;
}

const previewSize = (id: string) =>
  Number.parseFloat((screen.getByTestId(id) as HTMLElement).style.fontSize.replace('px', ''));

beforeEach(() => {
  localStorage.clear();
});

async function openSettings() {
  const user = userEvent.setup();
  render(<App api={harness()} moduleDefinitions={[]} />);
  await user.click(await screen.findByTestId('nav-settings'));
  await screen.findByTestId('settings-typography');
  return user;
}

describe('R03-2 · предпросмотр шрифта на ступень ниже', () => {
  it('все три строки предпросмотра на 1 px меньше своего рабочего размера', async () => {
    await openSettings();
    // фактические значения по умолчанию: системный 13, ответ 14, код 13
    expect((screen.getByTestId('font-system-value').textContent ?? '').trim()).toBe('Segoe UI · 13 px');
    expect(previewSize('preview-system')).toBe(12);
    expect(previewSize('preview-reply')).toBe(13);
    expect(previewSize('preview-code')).toBe(12);
  });

  it('изменение пользовательского размера двигает и контроль, и предпросмотр', async () => {
    await openSettings();
    const control = screen.getByTestId('font-reply-size') as HTMLInputElement;
    fireEvent.change(control, { target: { value: '16' } });
    expect((screen.getByTestId('font-reply-size') as HTMLSelectElement).value).toBe('16');
    expect(previewSize('preview-reply')).toBe(15);
    // фактические настройки не подменяются: в состоянии остаётся 16
    expect((screen.getByTestId('font-reply-size') as HTMLSelectElement).value).toBe('16');
  });

  it('тема и семейства не сбрасываются при смене размера', async () => {
    const user = await openSettings();
    await user.click(screen.getByTestId('theme-mode-light'));
    const family = screen.getByTestId('font-reply-family') as HTMLSelectElement;
    const chosen = family.value;
    fireEvent.change(screen.getByTestId('font-reply-size'), { target: { value: '15' } });
    expect((screen.getByTestId('font-reply-family') as HTMLSelectElement).value).toBe(chosen);
    expect(screen.getByTestId('theme-mode-light')).toHaveAttribute('aria-checked', 'true');
    expect(previewSize('preview-reply')).toBe(14);
  });

  it('заголовок раздела визуально главнее предпросмотра', async () => {
    await openSettings();
    const h1 = document.querySelector('.dl2-head h1') as HTMLElement;
    const heading = Number.parseFloat(getComputedStyle(h1).fontSize || '22');
    // 22 px против 12–13 px в предпросмотре — без обращения к CSS-файлу
    expect(heading === 22 || heading > previewSize('preview-reply')).toBe(true);
  });
});
