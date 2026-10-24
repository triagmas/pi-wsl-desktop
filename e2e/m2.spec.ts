/**
 * M2 E2E (real Electron window): Resources tab inventory from an ISOLATED
 * fixture agent-home, secret redaction on screen, and the full two-phase
 * write cycle against the committed fixture CLI — preview → confirm →
 * verified write → byte-exact rollback. Never touches the real ~/.pi.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp, waitForReady } from './launchApp';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const fakePiRpc = path.join(repoRoot, 'tests', 'fixtures', 'fake-pi-rpc');
const fakeCli = path.join(repoRoot, 'tests', 'fixtures', 'fake-resource-cli');

const SECRET = 'e2e-never-on-screen-777';

let home = '';
let proj = '';
let settingsPath = '';
let settingsShaBefore = '';

function makeFixture(): void {
  home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-e2e-m2home-'));
  proj = mkdtempSync(path.join(os.tmpdir(), 'piwsd-e2e-m2proj-'));
  const agent = path.join(home, '.pi', 'agent');
  mkdirSync(agent, { recursive: true });
  // user agents skills live under HOME/.agents/skills (skills.md) — NOT under
  // the agent dir (the first draft of this fixture put them in the wrong tree
  // and the inventory correctly reported zero skills).
  mkdirSync(path.join(home, '.agents', 'skills', 'code-review'), { recursive: true });
  mkdirSync(path.join(proj, '.git'), { recursive: true });
  mkdirSync(path.join(proj, '.pi'), { recursive: true });
  writeFileSync(
    path.join(home, '.agents', 'skills', 'code-review', 'SKILL.md'),
    `---\nname: code-review\ndescription: e2e fixture skill\n---\n# code-review\n`,
  );
  settingsPath = path.join(agent, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ packages: [], extensions: ['builtin:codemode'] }, null, 2));
  writeFileSync(path.join(agent, 'trust.json'), JSON.stringify({ [proj]: true }, null, 2));
  writeFileSync(
    path.join(agent, 'mcp.json'),
    JSON.stringify({ mcpServers: { boxed: { command: '/usr/bin/boxed', args: [], env: { E2E_TOKEN: SECRET } } } }, null, 2),
  );
  writeFileSync(path.join(proj, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(path.join(proj, '.pi', 'settings.json'), JSON.stringify({ packages: [] }, null, 2));
  settingsShaBefore = createHash('sha256').update(readFileSync(settingsPath)).digest('hex');
}

function launch(extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  // The fixture agent-home/cwd/resource CLI stay spec-owned; HOME and
  // userData come isolated from the shared launchApp fixture.
  return launchApp({
    PI_WS_DESKTOP_PI: fakePiRpc,
    PI_WS_DESKTOP_AGENT_HOME: home,
    PI_WS_DESKTOP_AGENT_CWD: proj,
    PI_WS_DESKTOP_RESOURCE_CLI: fakeCli,
    ...extra,
  });
}

test.describe('M2 resources E2E', () => {
  test.beforeAll(() => {
    makeFixture();
  });
  test.afterAll(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    if (proj) rmSync(proj, { recursive: true, force: true });
  });

  test('resources tab inventories the isolated home; secrets never reach the screen', async () => {
    const { app, page } = await launch();
    try {
      // UI-A R02 review P1: wait for a genuine bridge READY (not just the
      // sidebar being on screen) before the inventory request is issued.
      await waitForReady(page);
      await page.getByTestId('nav-resources').click();

      // Skills: fixture skill listed with provenance
      const skillRow = page.getByTestId('skill-row').filter({ hasText: 'code-review' });
      await expect(skillRow).toBeVisible({ timeout: 15_000 });
      await expect(skillRow).toContainText('user-agents');
      // R02: healthy rows carry no status badge (reference layout) — the
      // enabled state is expressed by the action button.
      await expect(skillRow.getByTestId('skill-status')).toHaveCount(0);
      await expect(skillRow.getByTestId('skill-toggle')).toHaveText('Отключить');

      // Packages: builtins visible
      await page.getByTestId('res-tab-packages').click();
      await expect(page.getByTestId('builtins-list')).toContainText('codemode — включено');

      // MCP: keys only — the env VALUE from the fixture never renders
      await page.getByTestId('res-tab-mcp').click();
      await expect(page.getByTestId('mcp-table')).toContainText('boxed');
      await expect(page.getByTestId('mcp-envkeys')).toHaveText('E2E_TOKEN');
      await expect(page.locator('body')).not.toContainText(SECRET);
      const bodyText = (await page.locator('body').textContent()) ?? '';
      expect(bodyText).not.toContain(SECRET);
    } finally {
      await app.close();
    }
  });

  test('two-phase write: preview shows the plan, confirm applies via fixture CLI, rollback restores bytes', async () => {
    const { app, page } = await launch();
    try {
      // UI-A R02 review P1: genuine bridge READY before inventory.
      await waitForReady(page);
      await page.getByTestId('nav-resources').click();
      const skillRow = page.getByTestId('skill-row').filter({ hasText: 'code-review' });
      await expect(skillRow).toBeVisible({ timeout: 15_000 });

      // preview → plan panel; NOTHING written yet
      await skillRow.getByTestId('skill-toggle').click();
      await expect(page.getByTestId('op-plan')).toBeVisible();
      await expect(page.getByTestId('op-files')).toContainText('settings.json');
      expect(createHash('sha256').update(readFileSync(settingsPath)).digest('hex')).toBe(settingsShaBefore);

      // cancel path: dismissed, still untouched
      await page.getByTestId('op-cancel').click();
      await expect(page.getByTestId('op-plan')).toHaveCount(0);
      expect(createHash('sha256').update(readFileSync(settingsPath)).digest('hex')).toBe(settingsShaBefore);

      // confirm path: applied + verified by the fixture CLI in the bridge
      await skillRow.getByTestId('skill-toggle').click();
      await expect(page.getByTestId('op-plan')).toBeVisible();
      await page.getByTestId('op-confirm').click();
      const result = page.getByTestId('op-result');
      await expect(result).toBeVisible({ timeout: 15_000 });
      await expect(result).toContainText('проверка: подтверждена');
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { skills?: string[] };
      expect(settings.skills).toContain(`-${path.join(home, '.agents', 'skills', 'code-review')}`);
      expect(createHash('sha256').update(readFileSync(settingsPath)).digest('hex')).not.toBe(settingsShaBefore);

      // inventory reflects the new state
      await expect(skillRow).toContainText('excluded', { timeout: 10_000 });

      // rollback → byte-exact restore
      await page.getByTestId('op-rollback').click();
      await expect(page.getByTestId('res-notice')).toContainText(/Откат/i, { timeout: 15_000 });
      expect(createHash('sha256').update(readFileSync(settingsPath)).digest('hex')).toBe(settingsShaBefore);
    } finally {
      await app.close();
    }
  });

  test('UI-A R02 P1: a delayed bridge start still inventories (no readiness race)', async () => {
    // The probe sleeps 2s before answering — a plain "sidebar is visible"
    // guard would issue the inventory request against a not-yet-READY
    // connection and hang. `waitForReady` waits for the real phase signal.
    const { app, page } = await launch({ FAKE_WSL_PROBE_MODE: 'slow' });
    try {
      await waitForReady(page);
      await page.getByTestId('nav-resources').click();
      const skillRow = page.getByTestId('skill-row').filter({ hasText: 'code-review' });
      await expect(skillRow).toBeVisible({ timeout: 20_000 });
    } finally {
      await app.close();
    }
  });
});
