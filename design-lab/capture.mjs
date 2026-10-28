#!/usr/bin/env node
/**
 * Design Lab capture (Issue #21, D1) — dev-only инструмент.
 *
 * Снимает 6 состояний × 4 вьюпорта с изолированного Vite dev-server
 * (npm run design) в artifacts/design-lab/ (gitignored).
 *
 * ЗАПРЕЩЕНО подключать к CI/tests: это вспомогательный инструмент визуального
 * цикла D1, не гейт. Реальные Electron E2E и полный Vitest здесь не запускаются.
 *
 * Использование:
 *   node design-lab/capture.mjs            # все состояния
 *   node design-lab/capture.mjs ref2 ref5  # только выбранные
 *
 * Разрешения честно подписаны в именах файлов:
 *   1586×992 — reference-native (1:1 к эталонам Issue #21),
 *   1440×900 / 1280×800 / 1024×768 — baseline/responsive.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const labDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(labDir);
const outDir = path.join(repoRoot, 'artifacts', 'design-lab');
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}/`;

const ALL_STATES = ['ref1', 'ref2', 'ref3', 'ref4', 'ref5', 'ref6', 'settings', 'demo'];
const VIEWPORTS = [
  { width: 1586, height: 992, tag: '1586x992-reference-native' },
  { width: 1440, height: 900, tag: '1440x900-baseline' },
  { width: 1280, height: 800, tag: '1280x800-medium' },
  { width: 1024, height: 768, tag: '1024x768-compact' },
];

const states = process.argv.slice(2).filter((s) => ALL_STATES.includes(s));
const selected = states.length ? states : ALL_STATES;

function log(msg) {
  process.stdout.write(`[capture] ${msg}\n`);
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* server not ready */
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`dev server not ready after ${timeoutMs}ms: ${url}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

const server = spawn(
  process.execPath,
  [path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', path.join(labDir, 'vite.config.ts')],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
);
server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));

let exitCode = 0;
try {
  await waitForServer(BASE);
  log(`dev server ready: ${BASE}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({
    env: { ...process.env, FONTCONFIG_FILE: path.join(labDir, 'fonts.conf') },
  });

  for (const state of selected) {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      await page.goto(`${BASE}?state=${state}&bare=1`, { waitUntil: 'networkidle' });
      // строковая форма: код исполняется в браузере, не в Node (eslint no-undef)
      await page.evaluate('document.fonts.ready.then(() => undefined)');
      await page.waitForTimeout(150);
      const file = path.join(outDir, `${state}-${vp.tag}.png`);
      await page.screenshot({ path: file });
      log(`saved ${path.relative(repoRoot, file)}`);
      await page.close();
    }
  }

  await browser.close();
} catch (err) {
  process.stderr.write(`[capture] FAILED: ${err?.stack ?? err}\n`);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
}

process.exit(exitCode);
