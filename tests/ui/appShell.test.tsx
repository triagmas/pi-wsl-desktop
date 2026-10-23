import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.queryByTestId('sidebar-projects')).not.toBeInTheDocument();
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
    expect(within(bar).getByTestId('status-connection')).toBeInTheDocument();
    expect(within(bar).getByTestId('status-distro')).toBeInTheDocument();
  });

  it('marks Windows host metrics as unavailable instead of inventing numbers (§6/§7)', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    const bar = screen.getByTestId('status-bar');
    expect(within(bar).getByTestId('status-cpu')).toHaveTextContent('—');
    expect(within(bar).getByTestId('status-ram')).toHaveTextContent('—');
    expect(within(bar).queryByText(/\d+\s*%/)).not.toBeInTheDocument();
  });

  it('renders NO fake terminal content in UI-A — slot only, explicitly deferred', () => {
    render(<App api={makeApi()} moduleDefinitions={[]} />);
    expect(screen.queryByTestId('terminal-dock')).not.toBeInTheDocument();
    expect(screen.queryByText(/bash|zsh|PS C:/i)).not.toBeInTheDocument();
    // the composer still reserves the space above the status bar (layout slot)
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
    const conn = screen.getByTestId('sidebar-connection');
    expect(conn).not.toHaveTextContent('Pi подключён');
    expect(conn).toHaveTextContent('Подключение');
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
