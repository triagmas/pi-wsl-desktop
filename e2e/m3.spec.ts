/**
 * M3 E2E (real Electron window): the built-in demo module registers, its tab
 * renders through the generic contract, and the Modules view disables /
 * re-enables it without ever taking the core down. Built as one scenario to
 * keep the paid-real-estate of a real window small.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { fakePi, launchApp } from './launchApp';


function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  // launchApp provides a throwaway HOME (module-state isolation), userData
  // and the fixture session root.
  return launchApp({ PI_WS_DESKTOP_PI: fakePi });
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
      await page.getByTestId('nav-modules').click();
      await expect(page.getByTestId('modules-view')).toHaveAttribute('data-loading', 'false');
      await expect(page.getByTestId('module-entry-module-0')).toBeVisible();
      await expect(page.getByTestId('module-row-state-module-0')).toHaveText('enabled');

      // 3. Disable: tab disappears, core views are unaffected.
      await page.getByTestId('module-toggle-demo').click();
      await expect(page.getByTestId('module-toggle-demo')).toBeEnabled();
      await expect(page.getByTestId('module-row-state-module-0')).toHaveText('disabled');
      await expect(page.getByTestId('tab-module-demo/welcome')).not.toBeVisible();
      await page.getByTestId('nav-chat').click();
      await expect(page.getByTestId('status-phase')).toHaveText(/Готово/);

      // 4. Re-enable: the tab comes back — the whole cycle holds.
      await page.getByTestId('nav-modules').click();
      await expect(page.getByTestId('modules-view')).toHaveAttribute('data-loading', 'false');
      await page.getByTestId('module-toggle-demo').click();
      await expect(page.getByTestId('module-toggle-demo')).toBeEnabled();
      await expect(page.getByTestId('module-row-state-module-0')).toHaveText('enabled');
      await expect(page.getByTestId('tab-module-demo/welcome')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
