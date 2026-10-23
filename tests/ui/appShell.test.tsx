import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi } from './helpers/shellApi';

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
