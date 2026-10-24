/**
 * R03 п.6 — automated path-sanitization for screenshot artifacts.
 * Every screenshot the owner reviews must be captured only after the visible
 * text is proven free of private/local paths (WSL mounts, the owner's home,
 * the repo checkout). The synthetic E2E environment (tmp HOME, synthetic
 * PI_WS_DESKTOP_AGENT_CWD, fixture cwds) must be the only path material that
 * ever reaches a PNG.
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Patterns that must never appear in rendered text or attributes. */
export const PRIVATE_PATH_PATTERNS: readonly RegExp[] = [
  /\/mnt\//, // WSL mounts (real checkout lives under /mnt/f/…)
  /_hermes/, // private parent directory of this repo
  /\/home\/triag/, // owner's real WSL home
  /home\\triag/,
  /C:\\/, // Windows drive-absolute user paths
  /CODE\/pi-wsl-desktop/, // repo location
  /\btriag\b/, // owner's username
];

export interface HygieneScan {
  text: string;
  matches: string[];
}

/** Collect visible innerText + input values + title attributes of a page. */
export async function scanForPrivatePaths(page: Page): Promise<HygieneScan> {
  const material = await page.evaluate(() => {
    const w = window as unknown as {
      document: {
        body: { innerText: string };
        querySelectorAll: (sel: string) => ArrayLike<{
          value?: string;
          title?: string;
          getAttribute: (n: string) => string | null;
        }>;
      };
    };
    const parts: string[] = [w.document.body.innerText];
    for (const sel of ['input', 'textarea', '[title]']) {
      for (const el of Array.from(w.document.querySelectorAll(sel))) {
        if (el.value) parts.push(el.value);
        if (el.title) parts.push(el.title);
        const aria = el.getAttribute('aria-label');
        if (aria) parts.push(aria);
      }
    }
    return parts.join('\n');
  });
  const matches = PRIVATE_PATH_PATTERNS.filter((re) => re.test(material)).map(String);
  return { text: material, matches };
}

/** Fail the test if any private path material is visible right now. */
export async function expectNoPrivatePaths(page: Page): Promise<void> {
  const { text, matches } = await scanForPrivatePaths(page);
  expect(
    matches,
    `private path material visible (patterns ${matches.join(', ')}):\n${text.slice(0, 2000)}`,
  ).toEqual([]);
}

/** Screenshot only after the hygiene gate passes — every reviewed PNG
 * goes through this wrapper. */
export async function sanitizedScreenshot(page: Page, path: string): Promise<void> {
  await expectNoPrivatePaths(page);
  await page.screenshot({ path });
}
