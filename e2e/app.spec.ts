import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');
import { fakeWsl, launchApp } from './launchApp';

interface LaunchOpts {
  env: Record<string, string>;
}

function launch(opts: LaunchOpts): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp(opts.env);
}

/** UI-A R02: connection diagnostics live in Settings → Connection. */
async function openConnectionSettings(page: Page): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-tab-connection').click();
}

test.describe('M0 desktop shell E2E (real Electron window)', () => {
  test('starts a secure window, reaches ready over the fake WSL transport and reports runtime info', async () => {
    const { app, page } = await launch({
      env: {
        PI_WS_DESKTOP_WSL_PATH: fakeWsl,
        PI_WS_DESKTOP_PI: fakePi,
        PI_WS_DESKTOP_TIMEOUT_MS: '8000',
        FAKE_WSL_PROBE_JSON: JSON.stringify({
          ok: true,
          nodePath: process.execPath,
          nodeVersion: process.version,
          home: '/home/fake',
          bridgeOk: true,
        }),
      },
    });
    try {
      await expect(page).toHaveTitle('Pi WSL Desktop');

      // Security posture: sandboxed renderer has no Node surface.
      const globals = await page.evaluate(() => ({
        process: typeof window.process,
        require: typeof (window as unknown as { require?: unknown }).require,
        module: typeof (window as unknown as { module?: unknown }).module,
        api: typeof window.piDesktop,
      }));
      expect(globals.process).toBe('undefined');
      expect(globals.require).toBe('undefined');
      expect(globals.module).toBe('undefined');
      expect(globals.api).toBe('object');

      // Connection reaches ready and shows the fixture Pi version.
      await openConnectionSettings(page);
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 20_000 });
      await expect(page.getByText('9.9.9')).toBeVisible();
      await expect(page.getByTestId('distro')).toBeVisible();

      // The typed request path works end-to-end through preload → ipc → bridge.
      const runtime = (await page.evaluate(() => window.piDesktop!.request('getRuntimeInfo'))) as {
        pi: { version: string; rpcSupported: boolean };
        node: { version: string };
      };
      expect(runtime.pi.version).toBe('9.9.9');
      expect(runtime.pi.rpcSupported).toBe(true);
      expect(runtime.node.version).toMatch(/^v\d+/);

      // Renderer rejects forbidden methods before any IPC happens.
      const denied = await page
        .evaluate(() => window.piDesktop!.request('exec').then(() => 'allowed', (e: Error) => e.message))
        .catch(() => 'evaluate-failed');
      expect(denied).toMatch(/not allowed/);
    } finally {
      await app.close();
    }
  });

  test('reports an error with a working retry button when WSL is unavailable', async () => {
    const { app, page } = await launch({
      env: {
        PI_WS_DESKTOP_WSL_PATH: path.join(repoRoot, 'nonexistent-wsl', 'wsl.exe'),
        PI_WS_DESKTOP_TIMEOUT_MS: '500',
        PI_WS_DESKTOP_MAX_ATTEMPTS: '2',
        PI_WS_DESKTOP_BACKOFF_MS: '100,100',
      },
    });
    try {
      await openConnectionSettings(page);
      await expect(page.getByTestId('status-phase')).toHaveText(/Ошибка/, { timeout: 30_000 });
      await expect(page.getByTestId('error-code')).toHaveText('WSL_UNAVAILABLE');
      const retry = page.getByRole('button', { name: /повторить/i });
      await expect(retry).toBeVisible();
      await retry.click();
      // retry restarts the cycle: error must not be a dead end
      await expect(page.getByTestId('status-phase')).toHaveText(/Ошибка|Подключени|Переподключени/, {
        timeout: 10_000,
      });
    } finally {
      await app.close();
    }
  });

  test('ready-gate E2E: PI_NOT_FOUND is shown instead of a false ready when Pi is missing', async () => {
    const { app, page } = await launch({
      env: {
        PI_WS_DESKTOP_WSL_PATH: fakeWsl,
        PI_WS_DESKTOP_PI: path.join(repoRoot, 'nonexistent-pi', 'pi'),
        PI_WS_DESKTOP_TIMEOUT_MS: '8000',
        FAKE_WSL_PROBE_JSON: JSON.stringify({
          ok: true,
          nodePath: process.execPath,
          nodeVersion: process.version,
          home: '/home/fake',
          bridgeOk: true,
        }),
      },
    });
    try {
      // Bridge reaches ready (fake wsl is healthy), but the Pi gate must fail.
      await openConnectionSettings(page);
      await expect(page.getByTestId('status-phase')).toHaveText(/Ошибка/, { timeout: 30_000 });
      await expect(page.getByTestId('error-code')).toHaveText('PI_NOT_FOUND');
      await expect(page.getByTestId('status-phase')).not.toHaveText(/Готово/);
      const retry = page.getByRole('button', { name: /повторить/i });
      await expect(retry).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('ready-gate E2E: PI_INCOMPATIBLE is shown when the pi build does not advertise RPC', async () => {
    const { app, page } = await launch({
      env: {
        PI_WS_DESKTOP_WSL_PATH: fakeWsl,
        PI_WS_DESKTOP_PI: path.join(repoRoot, 'tests', 'fixtures', 'fakepi-norpc'),
        PI_WS_DESKTOP_TIMEOUT_MS: '8000',
        FAKE_WSL_PROBE_JSON: JSON.stringify({
          ok: true,
          nodePath: process.execPath,
          nodeVersion: process.version,
          home: '/home/fake',
          bridgeOk: true,
        }),
      },
    });
    try {
      await openConnectionSettings(page);
      await expect(page.getByTestId('status-phase')).toHaveText(/Ошибка/, { timeout: 30_000 });
      await expect(page.getByTestId('error-code')).toHaveText('PI_INCOMPATIBLE');
      await expect(page.getByTestId('status-phase')).not.toHaveText(/Готово/);
      await expect(page.getByRole('button', { name: /повторить/i })).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
