/**
 * M3 regression: switching to a healthy module must unmount the failed
 * module's ErrorBoundary. Without a stable per-tab key in App, React reuses
 * ModuleTabView and an old error state poisons every subsequent tab.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { DEMO_MODULE_MANIFEST } from '../../src/renderer/modules/demoModule';
import type { ModuleTab } from '../../src/renderer/modules/registry';
import type { DesktopApi } from '../../src/renderer/api';
import type { RendererSnapshot } from '../../src/renderer/types';

// Intentionally inject a throwing renderer through the SAME ModuleTabView
// boundary App uses for all modules. No malformed manifests or external JS.
vi.mock('../../src/renderer/ModuleTabView', async () => {
  const { ModuleErrorBoundary } = await import('../../src/renderer/ModuleErrorBoundary');
  function Broken(): never {
    throw new Error('simulated module render failure');
  }
  return {
    ModuleTabView: ({ tab }: { tab: ModuleTab }) => (
      <ModuleErrorBoundary moduleId={tab.entry.id}>
        {tab.entry.id === 'broken' ? (
          <Broken />
        ) : (
          <span data-testid="healthy-module">Healthy module tab</span>
        )}
      </ModuleErrorBoundary>
    ),
  };
});

const READY: RendererSnapshot = {
  phase: 'ready',
  attempt: 0,
  distro: 'Ubuntu',
  distros: ['Ubuntu'],
  runtime: {
    distro: 'Ubuntu',
    node: { path: '/usr/bin/node', version: 'v22.0.0' },
    pi: { path: '/usr/bin/pi', version: '1.4.0', rpcSupported: true },
    agentDir: '/home/test/.pi/agent',
  },
};

function makeApi(): DesktopApi {
  return {
    request: vi.fn(async () => ({ ok: true })),
    getStatus: async () => READY,
    retry: vi.fn(async () => READY),
    listDistros: async () => ['Ubuntu'],
    selectDistro: vi.fn(async () => READY),
    onStateChange: () => () => undefined,
    onChatEvent: () => () => undefined,
        getAppearance: async () => undefined,
        saveAppearance: async () => undefined,
        resetAppearance: async () => undefined,
  };
}

describe('M3 module tab error boundary isolation', () => {
  it('recovers the healthy tab after a different module failed rendering', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <App
          api={makeApi()}
          moduleDefinitions={[
            { ...DEMO_MODULE_MANIFEST, id: 'broken' },
            { ...DEMO_MODULE_MANIFEST, id: 'healthy' },
          ]}
        />,
      );
      await user.click(screen.getByTestId('tab-module-broken/welcome'));
      expect(screen.getByTestId('module-error-broken')).toBeInTheDocument();

      await user.click(screen.getByTestId('tab-module-healthy/welcome'));
      expect(screen.getByTestId('healthy-module')).toBeInTheDocument();
      expect(screen.queryByTestId('module-error-broken')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-error-healthy')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
