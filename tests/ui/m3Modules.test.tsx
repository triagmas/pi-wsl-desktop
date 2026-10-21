/**
 * M3 UI: module registration end-to-end in the renderer — the demo module's
 * tab appears through ONE generic contract, Modules view toggles it, and
 * malformed / incompatible / throwing modules never take the app down.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { ModuleErrorBoundary } from '../../src/renderer/ModuleErrorBoundary';
import { DEMO_MODULE_MANIFEST } from '../../src/renderer/modules/demoModule';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

const READY: RendererSnapshot = {
  phase: 'ready',
  attempt: 0,
  distro: 'Ubuntu',
  distros: ['Ubuntu'],
  runtime: {
    distro: 'Ubuntu',
    node: { path: '/usr/bin/node', version: 'v22.0.0' },
    pi: { path: '/usr/bin/pi', version: '9.9.9', rpcSupported: true },
    agentDir: '/home/u/.pi/agent',
  },
};

function makeApi(): DesktopApi {
  return {
    request: vi.fn(async () => ({ ok: true })),
    getStatus: async () => READY,
    retry: vi.fn(async () => READY),
    listDistros: async () => READY.distros ?? [],
    selectDistro: vi.fn(async () => READY),
    onStateChange: () => () => undefined,
    onChatEvent: () => () => undefined,
  };
}

function Bomb(): ReactNode {
  throw new Error('взрыв модуля');
}

describe('M3 module registration UI', () => {
  it('renders the demo module tab through the generic contract and shows its state', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);

    const tab = screen.getByTestId('tab-module-demo/welcome');
    expect(tab).toHaveTextContent('Демо-модуль');

    await user.click(tab);
    expect(screen.getByTestId('module-tab-demo')).toBeInTheDocument();
    expect(screen.getByTestId('module-state-demo')).toHaveTextContent('enabled');
    // manifest echo proves the declared data reached the screen
    expect(screen.getByText(/demo@1\.0\.0/)).toBeInTheDocument();
  });

  it('disables and re-enables the demo module from the Modules view', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);

    await user.click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-entry-module-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-demo'));
    expect(screen.queryByTestId('tab-module-demo/welcome')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');

    await user.click(screen.getByTestId('module-toggle-demo'));
    expect(screen.getByTestId('tab-module-demo/welcome')).toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('enabled');
  });

  it('lists a malformed module with its reason while the valid module keeps working', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[DEMO_MODULE_MANIFEST, null]} />);

    await user.click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-entry-module-1')).toBeInTheDocument();
    expect(screen.getByTestId('module-errors-module-1')).toHaveTextContent(/expected object/i);

    await user.click(screen.getByTestId('tab-module-demo/welcome'));
    expect(screen.getByTestId('module-tab-demo')).toBeInTheDocument();
  });

  it('keeps the valid module working with several malformed forms registered alongside (Review Focus #1)', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          DEMO_MODULE_MANIFEST,
          { id: 'badver', version: '1.0', apiVersion: 1, capabilities: ['runtime'], ui: [{ kind: 'tab', id: 'x', title: 'X', blocks: [{ type: 'text', value: 'x' }] }] },
          { version: '1.0.0' }, // missing id
        ]}
      />,
    );

    await user.click(screen.getByTestId('tab-modules'));
    // both malformed entries are listed with a reason, not crashed on
    expect(screen.getByTestId('module-entry-module-1')).toBeInTheDocument();
    expect(screen.getByTestId('module-errors-module-1')).toHaveTextContent(/version/i);
    expect(screen.getByTestId('module-entry-module-2')).toBeInTheDocument();
    expect(screen.getByTestId('module-errors-module-2')).toHaveTextContent(/id/i);

    // the valid demo tab is untouched and still opens
    await user.click(screen.getByTestId('tab-module-demo/welcome'));
    expect(screen.getByTestId('module-tab-demo')).toBeInTheDocument();
  });

  it('marks an apiVersion-incompatible module and gives it no nav tab', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          DEMO_MODULE_MANIFEST,
          {
            id: 'future',
            version: '2.0.0',
            apiVersion: 99,
            capabilities: ['runtime'],
            ui: [{ kind: 'tab', id: 'main', title: 'Future', blocks: [{ type: 'text', value: 'x' }] }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('incompatible');
    // M1: the incompatible reason is actually visible to the user
    expect(screen.getByTestId('module-errors-module-1')).toHaveTextContent(/apiVersion/i);
    expect(screen.queryByTestId('tab-module-future/main')).not.toBeInTheDocument();
    // the built-in demo is unaffected
    expect(screen.getByTestId('tab-module-demo/welcome')).toBeInTheDocument();
  });

  it('isolates a module render error behind the boundary with a working escape', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const onDisable = vi.fn();
      render(
        <div>
          <div data-testid="sibling">ядро живо</div>
          <ModuleErrorBoundary moduleId="boom" onDisable={onDisable}>
            <Bomb />
          </ModuleErrorBoundary>
        </div>,
      );

      expect(screen.getByTestId('module-error-boom')).toBeInTheDocument();
      expect(screen.getByTestId('sibling')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /отключить модуль/i }));
      expect(onDisable).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});
