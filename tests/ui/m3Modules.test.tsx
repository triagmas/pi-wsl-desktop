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

  it('shows blocked dependencies and keeps unrelated valid modules interactive', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          DEMO_MODULE_MANIFEST,
          { ...DEMO_MODULE_MANIFEST, id: 'consumer', dependencies: ['absent'] },
        ]}
      />,
    );

    await user.click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('blocked');
    expect(screen.getByTestId('module-errors-module-1')).toHaveTextContent(/absent/i);
    expect(screen.getByTestId('module-toggle-consumer')).toHaveTextContent('Отключить');
    expect(screen.queryByTestId('tab-module-consumer/welcome')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('tab-module-demo/welcome'));
    expect(screen.getByTestId('module-tab-demo')).toBeInTheDocument();
  });

  it('removes dependent tabs when a provider is disabled and restores them on re-enable', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          { ...DEMO_MODULE_MANIFEST, id: 'consumer', dependencies: ['provider'] },
          { ...DEMO_MODULE_MANIFEST, id: 'provider' },
        ]}
      />,
    );
    expect(screen.getByTestId('tab-module-consumer/welcome')).toBeInTheDocument();

    await user.click(screen.getByTestId('tab-modules'));
    await user.click(screen.getByTestId('module-toggle-provider'));
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('blocked');
    expect(screen.getByTestId('module-errors-module-0')).toHaveTextContent(/provider/i);
    expect(screen.queryByTestId('tab-module-consumer/welcome')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-provider'));
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('enabled');
    expect(screen.getByTestId('tab-module-consumer/welcome')).toBeInTheDocument();
  });

  it('lets the user disable a dependency-blocked module instead of forcing auto-recovery', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          { ...DEMO_MODULE_MANIFEST, id: 'consumer', dependencies: ['missing'] },
          DEMO_MODULE_MANIFEST,
        ]}
      />,
    );

    await user.click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('blocked');
    expect(screen.getByTestId('module-toggle-consumer')).toHaveTextContent('Отключить');
    await user.click(screen.getByTestId('module-toggle-consumer'));
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');
    expect(screen.getByTestId('module-toggle-consumer')).toHaveTextContent('Включить');
    await user.click(screen.getByTestId('module-toggle-consumer'));
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('blocked');
  });

});

/* ------------------------------------------------------------------ */
/* M3 R03 UI — panels, actions, capability grants                       */
/* ------------------------------------------------------------------ */
describe('M3 R03 UI — panels, actions and capability grants', () => {
  const textBlock = { type: 'text', value: 'контент модуля' };

  it('renders a declared panel for an enabled module without adding a nav tab', async () => {
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          {
            id: 'sidekick',
            version: '1.0.0',
            apiVersion: 1,
            capabilities: ['runtime'],
            ui: [
              { kind: 'tab', id: 'main', title: 'Sidekick', blocks: [textBlock] },
              { kind: 'panel', id: 'rail', title: 'Rail', blocks: [textBlock] },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByTestId('module-panel-sidekick/rail')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-module-sidekick/rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-module-sidekick/main')).toBeInTheDocument();
  });

  it('drops the panel of a module the owner disables', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          {
            id: 'sidekick',
            version: '1.0.0',
            apiVersion: 1,
            capabilities: ['runtime'],
            ui: [{ kind: 'panel', id: 'rail', title: 'Rail', blocks: [textBlock] }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId('module-panel-sidekick/rail')).toBeInTheDocument();
    await user.click(screen.getByTestId('tab-modules'));
    await user.click(screen.getByTestId('module-toggle-sidekick'));
    expect(screen.queryByTestId('module-panel-sidekick/rail')).not.toBeInTheDocument();
  });

  it('renders declared actions as buttons and handles a click without throwing', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          {
            id: 'actor',
            version: '1.0.0',
            apiVersion: 1,
            capabilities: ['runtime'],
            ui: [{ kind: 'tab', id: 'main', title: 'Actor', blocks: [textBlock] }],
            actions: [
              { id: 'reload', title: 'Обновить', operation: 'refresh' },
              { id: 'go', title: 'Открыть вкладку', operation: 'openTab', target: 'actor/main' },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId('tab-module-actor/main'));
    expect(screen.getByTestId('module-action-actor/reload')).toBeInTheDocument();
    expect(screen.getByTestId('module-action-actor/go')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-action-actor/reload'));
    await user.click(screen.getByTestId('module-action-actor/go'));
    // a handled action must never surface an error state or crash the app
    expect(screen.queryByTestId('module-action-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-root')).toBeInTheDocument();
  });

  it('gives a module asking for an unoffered capability neither a tab nor a panel', async () => {
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          {
            id: 'greedy',
            version: '1.0.0',
            apiVersion: 1,
            capabilities: ['notifications'],
            ui: [
              { kind: 'tab', id: 'main', title: 'Greedy', blocks: [textBlock] },
              { kind: 'panel', id: 'rail', title: 'Rail', blocks: [textBlock] },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByTestId('tab-module-greedy/main')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-panel-greedy/rail')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-errors-module-0')).toHaveTextContent(/not provided by the host/i);
  });
});

describe('M3 R03 fix — action reachability and visible failure', () => {
  it('exposes the declared actions of a module that has a panel but no tab', () => {
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          {
            id: 'railmod',
            version: '1.0.0',
            apiVersion: 1,
            capabilities: ['runtime'],
            ui: [
              { kind: 'panel', id: 'only', title: 'Only panel', blocks: [{ type: 'text', value: 'p' }] },
            ],
            actions: [{ id: 'reload', title: 'Обновить', operation: 'refresh' }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId('module-panel-railmod/only')).toBeInTheDocument();
    expect(screen.getByTestId('module-action-railmod/reload')).toBeInTheDocument();
  });

  it('fails visibly when an action targets a tab that does not exist', async () => {
    const user = userEvent.setup();
    render(
      <App
        api={makeApi()}
        moduleDefinitions={[
          {
            id: 'actor',
            version: '1.0.0',
            apiVersion: 1,
            capabilities: ['runtime'],
            ui: [{ kind: 'tab', id: 'main', title: 'Actor', blocks: [{ type: 'text', value: 'a' }] }],
            actions: [
              { id: 'bad', title: 'Битая цель', operation: 'openTab', target: 'missing/nope' },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId('tab-module-actor/main'));
    await user.click(screen.getByTestId('module-action-actor/bad'));
    expect(screen.getByTestId('module-action-error')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* M3 R04 UI — external discovery, persisted toggles, honest failures   */
/* ------------------------------------------------------------------ */
describe('M3 R04 UI — external discovery and persistence', () => {
  const EXT_MANIFEST = {
    id: 'ext1',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['runtime'],
    ui: [{ kind: 'tab', id: 'welcome', title: 'Внешний', blocks: [{ type: 'text', value: 'внешний модуль' }] }],
  };

  function apiWith(request: ReturnType<typeof vi.fn>): DesktopApi {
    return { ...makeApi(), request: request as DesktopApi['request'] };
  }

  function payload(
    files: Array<{ file: string; status: string; raw?: unknown; errors?: string[] }>,
    state: Record<string, boolean> = {},
    diagnostics: string[] = [],
  ) {
    return { root: '/home/u/.pi-desktop/modules', available: true, files, diagnostics, state };
  }

  it('registers a discovered external manifest through the generic contract', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') return payload([{ file: 'ext.json', status: 'ok', raw: EXT_MANIFEST }]);
      return { id: 'ext1', enabled: true };
    });
    render(<App api={apiWith(request)} />);

    expect(await screen.findByTestId('tab-module-ext1/welcome')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('listModules');
  });

  it('applies persisted disabled state, then persists the toggle back', async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'listModules') {
        return payload([{ file: 'ext.json', status: 'ok', raw: EXT_MANIFEST }], { ext1: false });
      }
      return params ?? {};
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    expect(await screen.findByTestId('tab-modules')).toBeInTheDocument();
    await user.click(screen.getByTestId('tab-modules'));
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('disabled');
    expect(screen.queryByTestId('tab-module-ext1/welcome')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-ext1'));
    expect(request).toHaveBeenCalledWith('setModuleState', { id: 'ext1', enabled: true });
    expect(await screen.findByTestId('tab-module-ext1/welcome')).toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('enabled');
  });

  it('reverts the toggle and shows a visible error when persistence fails', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') {
        return payload([{ file: 'ext.json', status: 'ok', raw: EXT_MANIFEST }], { ext1: false });
      }
      throw new Error('WSL gone');
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    await user.click(await screen.findByTestId('tab-modules'));
    await user.click(screen.getByTestId('module-toggle-ext1'));

    const error = await screen.findByTestId('modules-persist-error');
    expect(error).toHaveTextContent('WSL gone');
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('disabled');
    expect(screen.queryByTestId('tab-module-ext1/welcome')).not.toBeInTheDocument();
  });

  it('keeps the demo working and surfaces bridge failure as visible diagnostics', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') throw new Error('WSL gone');
      return { id: 'demo', enabled: true };
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    await user.click(await screen.findByTestId('tab-modules'));
    expect(await screen.findByTestId('modules-diagnostics')).toHaveTextContent('WSL gone');
    expect(screen.getByTestId('tab-module-demo/welcome')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-demo'));
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');
    expect(screen.queryByTestId('modules-persist-error')).not.toBeInTheDocument();
  });

  it('shows per-file discovery errors in the diagnostics list', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') {
        return payload([{ file: 'link.json', status: 'error', errors: ['symlink rejected (not a regular file)'] }]);
      }
      return {};
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    await user.click(await screen.findByTestId('tab-modules'));
    const diagnostics = await screen.findByTestId('modules-diagnostics');
    expect(diagnostics).toHaveTextContent('link.json: symlink rejected (not a regular file)');
  });

  it('gives a discovered module with an unoffered capability no tab and no panel', async () => {
    const greedy = {
      id: 'greedy',
      version: '1.0.0',
      apiVersion: 1,
      capabilities: ['notifications'],
      ui: [
        { kind: 'tab', id: 'main', title: 'Greedy', blocks: [{ type: 'text', value: 'x' }] },
        { kind: 'panel', id: 'rail', title: 'Rail', blocks: [{ type: 'text', value: 'x' }] },
      ],
    };
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') return payload([{ file: 'greedy.json', status: 'ok', raw: greedy }]);
      return {};
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    await user.click(await screen.findByTestId('tab-modules'));
    expect(screen.queryByTestId('tab-module-greedy/main')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-panel-greedy/rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('incompatible');
    expect(screen.getByTestId('module-errors-module-1')).toHaveTextContent(/not provided by the host/i);
  });
});
