import { expect, test, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');

interface LaunchOpts {
  env: Record<string, string>;
}

async function launch(opts: LaunchOpts): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...opts.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const app = await electron.launch({
    args: [mainScript],
    env,
  });
  const page = await app.firstWindow();
  return { app, page };
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
});
