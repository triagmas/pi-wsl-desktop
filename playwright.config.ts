import { defineConfig } from '@playwright/test';

// M0 E2E drives a real Electron window via Playwright's Electron support.
// No browser projects are configured, so no browser binaries are required.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {},
});
