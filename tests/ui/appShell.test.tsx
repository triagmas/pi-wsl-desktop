import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi, READY_SNAPSHOT } from './helpers/shellApi';

/**
 * UI-A App Shell contract (Issue #21 §2/§4/§6/§9.4): independent sidebars,
 * persisted layout, status bar, an inert empty terminal slot, and the chat as
 * the default workspace — while M0–M3 behaviors keep working inside it.
 */
describe('App shell', () => {
  it('renders the shell: left sidebar, center workspace, status bar', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.getByTestId('left-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('center-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  it('starts with the projects sidebar expanded and the details panel hidden', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.getByTestId('left-sidebar')).not.toHaveAttribute('data-collapsed');
    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-details')).toBeInTheDocument();
  });

  it('hiding the details panel returns focus to its opening button (§8)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const open = screen.getByTestId('open-details');
    await user.click(open);
    expect(screen.getByTestId('right-sidebar')).toBeInTheDocument();
    await user.click(screen.getByTestId('close-details'));
    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-details')).toHaveFocus();
  });

  it('collapsing the sidebar hides project text and keeps icon navigation', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('left-sidebar')).toHaveAttribute('data-collapsed');
    expect(screen.queryByTestId('project-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-resources')).toBeInTheDocument();
    expect(screen.getByTestId('nav-modules')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
  });

  it('toggles the sidebar back open with the same button (tooltip labels follow state)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const toggle = screen.getByTestId('sidebar-collapse');
    expect(toggle).toHaveAttribute('title', 'Скрыть проекты');
    await user.click(toggle);
    expect(screen.getByTestId('sidebar-collapse')).toHaveAttribute('title', 'Показать проекты');
    await user.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('left-sidebar')).not.toHaveAttribute('data-collapsed');
  });

  it('the status bar shows the real Pi connection state and distro (§6 left side)', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const bar = screen.getByTestId('status-bar');
    // D2: статус-бар рендерит одобренный ui/StatusBar — контракт читается по
    // тексту реального состояния, а не по легаси-testid (ready-снапшот — микротаск).
    await waitFor(() => expect(within(bar).getByText(/Pi подключён/)).toBeInTheDocument());
    await waitFor(() => expect(within(bar).getByText(/Ubuntu · WSL/)).toBeInTheDocument());
  });

  it('marks Windows host metrics as unavailable instead of inventing numbers (§6/§7)', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const bar = screen.getByTestId('status-bar');
    expect(within(bar).getByText('CPU —')).toBeInTheDocument();
    expect(within(bar).getByText('RAM —')).toBeInTheDocument();
    expect(within(bar).queryByText(/\d+\s*%/)).not.toBeInTheDocument();
  });

  it('renders NO fake terminal content — empty slot plus an honest PTY notice (D2 dock)', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.getByTestId('terminal-dock')).toBeInTheDocument();
    expect(screen.queryByText(/bash|zsh|PS C:/i)).not.toBeInTheDocument();
    // the slot itself stays EMPTY (никаких фиктивных строк)
    expect(screen.getByTestId('terminal-slot')).toHaveTextContent('');
    expect(screen.getByTestId('terminal-dock')).toHaveTextContent(/PTY/i);
  });

  it('the status-bar terminal button toggles the dock (honest, not disabled)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    // в доке есть свой toggle (тоже «Терминал») — контракт-точка: кнопка статус-бара
    const toggle = within(screen.getByTestId('status-bar')).getByRole('button', { name: /терминал/i });
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(screen.queryByTestId('terminal-slot')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByTestId('terminal-slot')).toBeInTheDocument();
  });

  it('registers the chat event subscription on ready — M1 invariant (red)', async () => {
    // Regression pin: subscribeEvents used to ride on the default SessionsView
    // mount; with chat as the default screen the bridge never forwards stream
    // events unless App registers the subscription once the connection is up.
    const api = makeApi();
    render(<App api={api} />);
    await waitFor(() =>
      expect(api._request).toHaveBeenCalledWith('subscribeEvents', { topic: 'chat' }),
    );
  });

  it('fails closed when the bridge refuses to close the old session during a switch (review P1)', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const project = { id: '/work/repo', path: '/work/repo', sessionCount: 2, lastActivityAt: '2026-10-19T02:00:00.000Z' };
    const session = (id: string) => ({
      id,
      file: `/root/${id}.jsonl`,
      root: '/root',
      projectId: '/work/repo',
      projectPath: '/work/repo',
      name: id,
      createdAt: '2026-10-19T01:00:00.000Z',
      updatedAt: '2026-10-19T02:00:00.000Z',
      sizeBytes: 512,
      version: 3,
      availability: 'ok',
      activeWrite: false,
      diagnostics: null,
    });
    api._request.mockImplementation(async (method: string) => {
      if (method === 'listProjects') return { projects: [project], diagnostics: [] };
      if (method === 'listSessions') return { sessions: [session('s1'), session('s2')], diagnostics: [] };
      if (method === 'openSession') return { state: null };
      if (method === 'readSession')
        return { header: null, entries: [], leafId: null, nextCursor: null, truncated: false, partialTrailing: false, diagnostics: [], availability: 'ok' };
      if (method === 'closeSession') throw new Error('close refused');
      if (method === 'subscribeEvents') return { subscribed: true };
      return { ok: true };
    });
    render(<App api={api} moduleDefinitions={[]} />);
    await user.click(await screen.findByTestId('session-s1'));
    await user.click(await screen.findByTestId('tab-chat'));
    await user.click(screen.getByRole('button', { name: 'Открыть чат' }));
    await waitFor(() => expect(screen.getByTestId('chat-status')).toBeInTheDocument());
    await user.click(screen.getByTestId('session-s2'));
    expect(screen.getByTestId('switch-confirm')).toBeInTheDocument();
    await user.click(screen.getByTestId('switch-confirm'));
    // Fail-closed: the confirm dialog stays up — the old session may still be
    // live, so the UI must not present the other one as active.
    expect(await screen.findByTestId('switch-cancel')).toBeInTheDocument();
    // The refusal path is a real close attempt against the OLD session …
    expect(api._request.mock.calls.some((c) => c[0] === 'closeSession')).toBe(true);
    // … and the old row remains the active one (aria-current), the new one not.
    expect(screen.getByTestId('session-s1')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('session-s2')).toHaveAttribute('aria-current', 'false');
  });

  it('never claims a connected Pi while the bridge is still starting (review P2)', () => {
    render(<App api={makeApi({ ...READY_SNAPSHOT, phase: 'connecting' })} moduleDefinitions={[]} />);
    const conn = within(screen.getByTestId('left-sidebar')).getByText(/Подключение/);
    expect(conn).toBeInTheDocument();
    expect(screen.getByTestId('left-sidebar')).not.toHaveTextContent(/Pi подключён/);
  });

  it('a preset switch while the custom editor is open is not rolled back by the restore cleanup (round-2 P2)', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const bg = () =>
      (document.documentElement as HTMLElement & { style: CSSStyleDeclaration }).style.getPropertyValue(
        '--pw-window-background-color',
      );
    // App's layout effect applies the persisted (dark) theme before settings open.
    await user.click(screen.getByTestId('nav-settings'));
    expect(bg()).toBe('#20221F');
    // Open the custom editor (live preview engages).
    await user.click(screen.getByTestId('theme-card-custom'));
    expect(screen.getByTestId('theme-editor')).toBeInTheDocument();
    // Switch the SAVED preset while the editor is still open: App re-applies
    // Light in its layout effect; the editor-close cleanup must NOT roll the
    // document back to the pre-switch snapshot.
    await user.click(screen.getByTestId('theme-card-light'));
    expect(bg()).toBe('#FAF9F6');
    // Closing the editor restores the CURRENT persisted appearance (light).
    await user.click(screen.getByTestId('theme-cancel'));
    expect(bg()).toBe('#FAF9F6');
  });

  it('navigates to Resources and Modules from the sidebar without losing the chat state', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('nav-resources'));
    expect(screen.getByTestId('view-resources')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-modules'));
    expect(screen.getByTestId('view-modules')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-chat'));
    expect(screen.getByTestId('view-chat')).toBeInTheDocument();
  });

  it('switching views never resets the active connection (state lives above panels)', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const { rerender } = render(<App api={api} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('nav-resources'));
    await user.click(screen.getByTestId('nav-chat'));
    expect(screen.getByTestId('view-chat')).toBeInTheDocument();
    // no reconnect side effects: status endpoint untouched by view changes
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    rerender(<App api={api} moduleDefinitions={[]} />);
  });
});

/**
 * D2 integration contract (Issue #21 owner decision #6395777040):
 * resizable+persisted panels, honest button labels, wired window controls.
 */
describe('D3: single approved Design Lab composition', () => {
  it('mounts the Design Lab hierarchy — .dl-side children directly, no legacy wrappers', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const frame = document.querySelector('.dl-frame[data-layout="app"]');
    expect(frame).not.toBeNull();
    const side = frame!.querySelector(':scope > .dl-side');
    expect(side).not.toBeNull();
    // старые обёртки D2 (shell-контейнеры) упразднены
    expect(side!.querySelector(':scope > .left-sidebar')).toBeNull();
    expect(side!.querySelector('.dl-side-wrap')).toBeNull();
    // approved-узлы: Sidebar (aside.dl-sidebar) или Rail
    expect(
      side!.querySelector('.dl-sidebar[data-testid], .dl-rail[data-testid]')?.getAttribute(
        'data-testid',
      ),
    ).toBe('left-sidebar');
    // один crumb-row главного экрана (нет отдельного legacy centerHeader)
    expect(frame!.querySelectorAll('.dl-app-crumb')).toHaveLength(1);
    // статус-бар: ui/StatusBar без legacy-обёртки .status-bar
    const footer = frame!.querySelector('footer[data-testid="status-bar"]');
    expect(footer).not.toBeNull();
    expect(footer!.querySelector('.status-bar')).toBeNull();
    expect(footer!.querySelector('.dl-status-group')).not.toBeNull();
  });

  it('empty chat: no legacy StatusPanel diagnostics — compact connection inside the approved chat chain', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.getByTestId('chat-empty')).toBeInTheDocument();
    // компактная информация о подключении сохраняет контракт phaseText
    expect(screen.getByTestId('status-phase')).toBeInTheDocument();
    // legacy StatusPanel-диагностика (runtime dl/distro-блок) убрана из главного экрана
    expect(screen.queryByRole('region', { name: 'Состояние подключения' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('runtime')).not.toBeInTheDocument();
    // пустое состояние живёт внутри чат-композиции (цепь ChatView)
    expect(document.querySelector('.dl-msgs')).not.toBeNull();
  });
});

describe('D2 layout integration', () => {
  it('left sidebar resizes by drag and persists the width on release', async () => {
    const api = makeApi();
    render(<App api={api} moduleDefinitions={[]} />);
    const handle = screen.getByRole('separator', { name: /ширина левой панели/i });
    const aside = screen.getByTestId('left-sidebar');
    expect(aside).toHaveStyle({ width: '321px' }); // DEFAULT_APPEARANCE.layout.leftWidth = канон лабы
    fireEvent.mouseDown(handle, { clientX: 321, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 340, clientY: 100 });
    expect(aside).toHaveStyle({ width: '340px' }); // live preview
    fireEvent.mouseUp(window, { clientX: 340, clientY: 100 });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ leftWidth: 340 }) }),
      ),
    );
  });

  it('left sidebar drag clamps to 200..480 and keyboard steps by 16px', async () => {
    const api = makeApi();
    render(<App api={api} moduleDefinitions={[]} />);
    const handle = screen.getByRole('separator', { name: /ширина левой панели/i });
    fireEvent.mouseDown(handle, { clientX: 321, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 100 });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ leftWidth: 200 }) }),
      ),
    );
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ leftWidth: 216 }) }),
      ),
    );
  });

  it('right details panel resizes from its left edge and persists', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<App api={api} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('open-details'));
    const handle = screen.getByRole('separator', { name: /ширина правой панели/i });
    fireEvent.mouseDown(handle, { clientX: 800, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 720, clientY: 100 }); // тянется влево → шире
    fireEvent.mouseUp(window, { clientX: 720, clientY: 100 });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ rightWidth: 420 }) }),
      ),
    );
  });

  it('terminal dock resizes by height (120..600) and persists', async () => {
    const api = makeApi();
    render(<App api={api} moduleDefinitions={[]} />);
    const handle = screen.getByRole('separator', { name: /высота терминала/i });
    fireEvent.mouseDown(handle, { clientX: 600, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 560 }); // вниз → ниже
    fireEvent.mouseUp(window, { clientX: 600, clientY: 560 });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ terminalSlotHeight: 180 }) }),
      ),
    );
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ terminalSlotHeight: 196 }) }),
      ),
    );
  });

  it('«Новый диалог» is honestly labeled — it opens the most recent session, no fake creation', async () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(
      screen.getAllByRole('button', { name: /открыть последний диалог/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /^Новый диалог$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-empty')).toHaveTextContent(/самую свежую сессию/i);
  });

  it('C1: sidebar head carries the approved «Открыть проект» label and the long new-chat label is a non-wrapping span', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    // P3: эталонная шапка 01-chat-review-terminal (паритет design-lab;
    // статичный span — действия открытия проекта в мосту нет, честно).
    expect(screen.getByText('Открыть проект')).toBeInTheDocument();
    // P5: подпись длинной кнопки в отдельном span — CSS не даёт переносу
    // на две строки при любом ширины панели/кегле.
    const label = document.querySelector('.dl-newchat-text');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Открыть последний диалог');
  });

  it('wires the frameless titlebar buttons to the window controls', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<App api={api} moduleDefinitions={[]} />);
    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    await user.click(screen.getByRole('button', { name: 'Развернуть' }));
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(api._windowControls.minimize).toHaveBeenCalledTimes(1);
    expect(api._windowControls.maximize).toHaveBeenCalledTimes(1);
    expect(api._windowControls.close).toHaveBeenCalledTimes(1);
  });

  it('review P1-4: an early layout gesture never clobbers stored theme/typography (queued persist)', async () => {
    const api = makeApi();
    let resolveLoad!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolveLoad = r;
    });
    api.getAppearance = (async () => pending) as unknown as typeof api.getAppearance;
    render(<App api={api} moduleDefinitions={[]} />);

    // жест ДО завершения загрузки appearance
    const handle = screen.getByRole('separator', { name: /ширина левой панели/i });
    fireEvent.mouseDown(handle, { clientX: 321, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 340, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 340, clientY: 100 });
    // сохранение не уходит полным default-объектом раньше загрузки
    expect(api._saveAppearance).not.toHaveBeenCalled();

    // поздняя загрузка приходит с сохранёнными nondefault настройками
    resolveLoad({
      theme: { preset: 'light', custom: null },
      typography: { ui: { fontFamily: 'Inter', fontSizePx: 19, lineHeight: 1.4, weight: 500 } },
      layout: { leftWidth: 300 },
    });

    await waitFor(() => expect(api._saveAppearance).toHaveBeenCalledTimes(1));
    const saved = api._saveAppearance.mock.calls[0][0];
    expect(saved.theme.preset).toBe('light'); // сохранённая тема не затёрта
    expect(saved.typography.ui.fontSizePx).toBe(19); // и типографика тоже
    expect(saved.layout.leftWidth).toBe(340); // жест применился поверх загруженного
    expect(screen.getByTestId('left-sidebar')).toHaveStyle({ width: '340px' });
  });

  it('review N1: Settings are not editable until appearance load resolves', async () => {
    const api = makeApi();
    let resolveLoad!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolveLoad = r;
    });
    api.getAppearance = (async () => pending) as unknown as typeof api.getAppearance;
    render(<App api={api} moduleDefinitions={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('nav-settings'));
    // до ready экран настроек недоступен — иначе поздний load затирает
    // выбор пользователя полным сохранённым объектом (N1)
    expect(screen.queryByTestId('settings-root')).not.toBeInTheDocument();
    resolveLoad(undefined);
    await waitFor(() => expect(screen.getByTestId('settings-root')).toBeInTheDocument());
  });

  it('review P2-7: right panel keyboard follows separator direction (invert)', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<App api={api} moduleDefinitions={[]} />);
    await user.click(screen.getByTestId('open-details'));
    const handle = screen.getByRole('separator', { name: /ширина правой панели/i });
    expect(handle).toHaveAttribute('aria-valuenow', '340');
    // ArrowLeft = «переместить левый край влево» → панель шире (invert)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ rightWidth: 356 }) }),
      ),
    );
    // ArrowRight = обратно
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(api._saveAppearance).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ rightWidth: 340 }) }),
      ),
    );
  });
});
