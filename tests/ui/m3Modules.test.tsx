/**
 * M3 UI: module registration end-to-end in the renderer — the demo module's
 * tab appears through ONE generic contract, Modules view toggles it, and
 * malformed / incompatible / throwing modules never take the app down.
 */
import { render, screen, waitFor } from '@testing-library/react';
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

/**
 * Review #1/#6 gate: initial discovery must settle before toggles become
 * clickable, and one module's persist must finish before the next toggle.
 */
async function settleLoad(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('modules-view')).toHaveAttribute('data-loading', 'false'),
  );
}

async function settleToggle(id: string): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(`module-toggle-${id}`)).toBeEnabled());
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
    await settleLoad();
    expect(screen.getByTestId('module-entry-module-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-demo'));
    await settleToggle('demo');
    expect(screen.queryByTestId('tab-module-demo/welcome')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');

    await user.click(screen.getByTestId('module-toggle-demo'));
    await settleToggle('demo');
    expect(screen.getByTestId('tab-module-demo/welcome')).toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('enabled');
  });

  it('lists a malformed module with its reason while the valid module keeps working', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} moduleDefinitions={[DEMO_MODULE_MANIFEST, null]} />);

    await user.click(screen.getByTestId('tab-modules'));
    await settleLoad();
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
    await settleLoad();
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
    await settleLoad();
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
    await settleLoad();
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
    await settleLoad();
    await user.click(screen.getByTestId('module-toggle-provider'));
    await settleToggle('provider');
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('blocked');
    expect(screen.getByTestId('module-errors-module-0')).toHaveTextContent(/provider/i);
    expect(screen.queryByTestId('tab-module-consumer/welcome')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-provider'));
    await settleToggle('provider');
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
    await settleLoad();
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('blocked');
    expect(screen.getByTestId('module-toggle-consumer')).toHaveTextContent('Отключить');
    await user.click(screen.getByTestId('module-toggle-consumer'));
    await settleToggle('consumer');
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');
    expect(screen.getByTestId('module-toggle-consumer')).toHaveTextContent('Включить');
    await user.click(screen.getByTestId('module-toggle-consumer'));
    await settleToggle('consumer');
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
    await settleLoad();
    await user.click(screen.getByTestId('module-toggle-sidekick'));
    await settleToggle('sidekick');
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
    await settleLoad();
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
    return { available: true, files, diagnostics, state };
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
    await settleLoad();
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('disabled');
    expect(screen.queryByTestId('tab-module-ext1/welcome')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-ext1'));
    await settleToggle('ext1');
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
    await settleLoad();
    await user.click(screen.getByTestId('module-toggle-ext1'));
    await settleToggle('ext1');

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
    await settleLoad();
    expect(await screen.findByTestId('modules-diagnostics')).toHaveTextContent('WSL gone');
    expect(screen.getByTestId('tab-module-demo/welcome')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-toggle-demo'));
    await settleToggle('demo');
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
    await settleLoad();
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
    await settleLoad();
    expect(screen.queryByTestId('tab-module-greedy/main')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-panel-greedy/rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-1')).toHaveTextContent('incompatible');
    expect(screen.getByTestId('module-errors-module-1')).toHaveTextContent(/not provided by the host/i);
  });
  it('defers discovery until the connection is ready and reloads on distro switch (review #1)', async () => {
    let current: RendererSnapshot = { ...READY, phase: 'connecting' };
    const subs: Array<(s: RendererSnapshot) => void> = [];
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') return payload([]);
      return {};
    });
    const api: DesktopApi = {
      request: request as DesktopApi['request'],
      getStatus: async () => current,
      retry: vi.fn(async () => current),
      listDistros: async () => ['Ubuntu', 'Ubuntu中文'],
      selectDistro: vi.fn(async (d: string) => {
        current = { ...READY, phase: 'ready', distro: d };
        for (const cb of subs) cb(current);
        return current;
      }),
      onStateChange: (cb) => {
        subs.push(cb);
        return () => undefined;
      },
      onChatEvent: () => () => undefined,
    };
    render(<App api={api} />);

    // not ready → discovery must NOT fire (WslConnection rejects pre-ready)
    await new Promise((r) => setTimeout(r, 0));
    expect(request.mock.calls.filter((c) => c[0] === 'listModules')).toHaveLength(0);

    // connect → discovery runs
    current = { ...READY, phase: 'ready' };
    for (const cb of subs) cb(current);
    await waitFor(() =>
      expect(request.mock.calls.filter((c) => c[0] === 'listModules')).toHaveLength(1),
    );

    // distro switch → the registry/persistence must reload for the NEW distro
    await api.selectDistro('Ubuntu中文');
    await waitFor(() =>
      expect(request.mock.calls.filter((c) => c[0] === 'listModules').length).toBeGreaterThanOrEqual(2),
    );
  });

  it('keeps toggles disabled until initial discovery settles (review #6)', async () => {
    let resolveLoad!: (v: unknown) => void;
    const request = vi.fn((method: string) => {
      if (method === 'listModules') {
        return new Promise((res) => {
          resolveLoad = res;
        });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    await user.click(await screen.findByTestId('tab-modules'));
    const toggle = screen.getByTestId('module-toggle-demo');
    expect(toggle).toBeDisabled();
    expect(screen.getByTestId('modules-view')).toHaveAttribute('data-loading', 'true');

    resolveLoad(payload([]));
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.getByTestId('modules-view')).toHaveAttribute('data-loading', 'false');
  });

  it('blocks a second toggle while persistence is in flight (review #6)', async () => {
    let resolvePersist!: (v: unknown) => void;
    const request = vi.fn((method: string) => {
      if (method === 'listModules') return Promise.resolve(payload([]));
      return new Promise((res) => {
        resolvePersist = res;
      });
    });
    const user = userEvent.setup();
    render(<App api={apiWith(request)} />);

    await user.click(await screen.findByTestId('tab-modules'));
    await settleLoad();

    await user.click(screen.getByTestId('module-toggle-demo'));
    // optimistic state applied, but the module is locked while persisting
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');
    expect(screen.getByTestId('module-toggle-demo')).toBeDisabled();

    // a second click while in flight must be ignored (no second write op)
    await user.click(screen.getByTestId('module-toggle-demo'));
    resolvePersist({});
    await settleToggle('demo');
    expect(screen.getByTestId('module-row-state-module-0')).toHaveTextContent('disabled');
    expect(
      request.mock.calls.filter((c) => c[0] === 'setModuleState'),
    ).toHaveLength(1);
  });


  it('re-discovery after a same-distro reconnect re-gates toggles (review N1)', async () => {
    let current: RendererSnapshot = { ...READY, phase: 'ready' };
    const subs: Array<(s: RendererSnapshot) => void> = [];
    const emit = (s: RendererSnapshot) => {
      current = s;
      for (const cb of subs) cb(s);
    };
    let loads = 0;
    let resolveSecond!: (v: unknown) => void;
    const request = vi.fn((method: string) => {
      if (method === 'listModules') {
        loads += 1;
        if (loads >= 2) {
          return new Promise((res) => {
            resolveSecond = res;
          });
        }
        return Promise.resolve(payload([]));
      }
      return Promise.resolve({});
    });
    const api: DesktopApi = {
      request: request as DesktopApi['request'],
      getStatus: async () => current,
      retry: vi.fn(async () => current),
      listDistros: async () => ['Ubuntu'],
      selectDistro: vi.fn(async () => current),
      onStateChange: (cb) => {
        subs.push(cb);
        return () => undefined;
      },
      onChatEvent: () => () => undefined,
    };
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.click(await screen.findByTestId('tab-modules'));
    await settleLoad();

    // reconnect of the SAME distro: main/state.ts resets attempt to 0 on
    // READY, so the previous key string repeats — the generation must not.
    emit({ ...current, phase: 'connecting', attempt: 1 });
    emit({ ...current, phase: 'ready', attempt: 0 });

    await waitFor(() => expect(loads).toBe(2));
    expect(screen.getByTestId('modules-view')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('module-toggle-demo')).toBeDisabled();

    resolveSecond(payload([]));
    await waitFor(() => expect(screen.getByTestId('module-toggle-demo')).toBeEnabled());
  });

  it('a failed discovery after switching distro drops the previous registry (review N2)', async () => {
    let mode: 'ok' | 'fail' = 'ok';
    const request = vi.fn(async (method: string) => {
      if (method === 'listModules') {
        if (mode === 'fail') throw new Error('WSL gone');
        return payload([{ file: 'ext.json', status: 'ok', raw: EXT_MANIFEST }]);
      }
      return {};
    });
    const withTwoDistros: RendererSnapshot = { ...READY, distros: ['Ubuntu', 'Ubuntu中文'] };
    const api: DesktopApi = {
      ...makeApi(),
      request: request as DesktopApi['request'],
      getStatus: async () => withTwoDistros,
      listDistros: async () => ['Ubuntu', 'Ubuntu中文'],
      selectDistro: vi.fn(
        async (d: string): Promise<RendererSnapshot> => ({ ...withTwoDistros, phase: 'ready', distro: d }),
      ),
    };
    const user = userEvent.setup();
    render(<App api={api} />);

    expect(await screen.findByTestId('tab-module-ext1/welcome')).toBeInTheDocument();

    // switch distro (B) whose discovery FAILS: the previous environment's
    // registry must not stay on screen — toggles would persist into B.
    mode = 'fail';
    const select = await screen.findByRole('combobox');
    await user.selectOptions(select, 'Ubuntu中文');

    await user.click(await screen.findByTestId('tab-modules'));
    await settleLoad();
    await waitFor(() => expect(screen.getByTestId('modules-diagnostics')).toHaveTextContent('WSL gone'));
    // the previous environment's external registry is gone; demo-only remains
    expect(screen.queryByTestId('module-row-state-module-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-state-module-0')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-module-ext1/welcome')).not.toBeInTheDocument();
  });

  it('falls back to the Modules view when a failed re-discovery drops the open module tab (review #3 P2)', async () => {
    let mode: 'ok' | 'fail' = 'ok';
    let loads = 0;
    const request = vi.fn((method: string) => {
      if (method === 'listModules') {
        loads += 1;
        if (mode === 'fail') return Promise.reject(new Error('WSL gone'));
        return Promise.resolve(payload([{ file: 'ext.json', status: 'ok', raw: EXT_MANIFEST }]));
      }
      return Promise.resolve({});
    });
    let current: RendererSnapshot = { ...READY, phase: 'ready' };
    const subs: Array<(s: RendererSnapshot) => void> = [];
    const api: DesktopApi = {
      request: request as DesktopApi['request'],
      getStatus: async () => current,
      retry: vi.fn(async () => current),
      listDistros: async () => ['Ubuntu'],
      selectDistro: vi.fn(async () => current),
      onStateChange: (cb) => {
        subs.push(cb);
        return () => undefined;
      },
      onChatEvent: () => () => undefined,
    };
    const user = userEvent.setup();
    render(<App api={api} />);

    // open the external module's tab
    await user.click(await screen.findByTestId('tab-module-ext1/welcome'));
    expect(loads).toBe(1);

    // reconnect whose discovery fails: the open tab disappears with the
    // registry — the view must fall back to an ACTIVE nav destination
    mode = 'fail';
    current = { ...current, phase: 'connecting', attempt: 1 };
    for (const cb of subs) cb(current);
    current = { ...current, phase: 'ready', attempt: 0 };
    for (const cb of subs) cb(current);

    await waitFor(() => expect(screen.getByTestId('modules-diagnostics')).toHaveTextContent('WSL gone'));
    expect(screen.queryByTestId('module-tab-ext1')).not.toBeInTheDocument();
    // review #3 P2: no orphaned view — the Modules nav button is active again
    expect(screen.getByTestId('tab-modules')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('modules-heading')).toBeInTheDocument();
  });

});
