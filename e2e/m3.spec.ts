/**
 * M3 E2E (real Electron window): the built-in demo module registers, its tab
 * renders through the generic contract, and the Modules view disables /
 * re-enables it without ever taking the core down. Built as one scenario to
 * keep the paid-real-estate of a real window small.
 */
import { expect, test, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const mainScript = path.join(repoRoot, 'dist', 'main', 'index.cjs');
const fakeWsl = path.join(repoRoot, 'tests', 'fixtures', 'fake-wsl');
const fakePi = path.join(repoRoot, 'tests', 'fixtures', 'fakepi');

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
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
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const app = await electron.launch({ args: [mainScript], env });
  const page = await app.firstWindow();
  return { app, page };
}

test.describe('M3 module system E2E', () => {
  test('demo module registers, renders its tab, and survives disable/enable from the Modules view', async () => {
    const { app, page } = await launch();
    try {
      await expect(page).toHaveTitle('Pi WSL Desktop');
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/, { timeout: 30_000 });

      // 1. The demo module's tab is registered and visible through the generic contract.
      const demoTab = page.getByTestId('tab-module-demo/welcome');
      await expect(demoTab).toBeVisible();
      await demoTab.click();
      await expect(page.getByTestId('module-tab-demo')).toBeVisible();
      await expect(page.getByTestId('module-state-demo')).toHaveText('enabled');

      // 2. Modules view lists the registered module with an honest state.
      await page.getByTestId('tab-modules').click();
      await expect(page.getByTestId('module-entry-module-0')).toBeVisible();
      await expect(page.getByTestId('module-row-state-module-0')).toHaveText('enabled');

      // 3. Disable: tab disappears, core views are unaffected.
      await page.getByTestId('module-toggle-demo').click();
      await expect(page.getByTestId('module-row-state-module-0')).toHaveText('disabled');
      await expect(page.getByTestId('tab-module-demo/welcome')).not.toBeVisible();
      await page.getByTestId('tab-status').click();
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/);

      // 4. Re-enable: the tab comes back — the whole cycle holds.
      await page.getByTestId('tab-modules').click();
      await page.getByTestId('module-toggle-demo').click();
      await expect(page.getByTestId('module-row-state-module-0')).toHaveText('enabled');
      await expect(page.getByTestId('tab-module-demo/welcome')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
