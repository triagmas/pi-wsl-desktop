/**
 * UI26 R05: платформенная проверка локальной поставки Electron.
 *
 * Зачем: `npm start` запускает `electron .` из `node_modules/electron`, а этот
 * каталог заполняется под ТЕКУЩУЮ ОС. На этом checkout (WSL/Linux) там лежит
 * Linux-сборка (`path.txt` = `electron`, `libffmpeg.so`, `chrome-sandbox`), и
 * запуск из Windows падает молча: процесс завершается до `app.whenReady()`,
 * окна нет, в Application log пусто, код 0xFFFF7003.
 *
 * Проверка превращает этот тихий отказ в явную диагностику с действиями.
 * Она ничего не запускает, ничего не пишет и не меняет профиль Pi.
 *
 * Использование:
 *   node scripts/check-electron-dist.mjs                 # текущая платформа
 *   node scripts/check-electron-dist.mjs --platform win32 --dist <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Маркеры платформенных сборок Electron (без самих бинарников). */
export const PLATFORM_MARKERS = {
  win32: ['electron.exe', 'ffmpeg.dll', 'd3dcompiler_47.dll', 'vulkan-1.dll', 'vk_swiftshader.dll'],
  linux: ['electron', 'chrome-sandbox', 'libffmpeg.so'],
  darwin: ['Electron.app'],
};

/** Общие для всех сборок файлы: их отсутствие = поставка неполная. */
export const COMMON_MARKERS = ['resources.pak', 'icudtl.dat', 'snapshot_blob.bin'];

/**
 * Чистая проверка: какие маркеры платформы и общие файлы отсутствуют.
 * Возвращает `{ ok, platform, missing, foreign }`, где `foreign` — маркеры
 * ДРУГОЙ платформы, найденные в каталоге (признак перепутанной сборки).
 */
export function verifyElectronDist(platform, entries) {
  const files = new Set(entries);
  const own = PLATFORM_MARKERS[platform] ?? [];
  const missing = [...COMMON_MARKERS, ...own].filter((m) => !files.has(m));
  const foreign = Object.entries(PLATFORM_MARKERS)
    .filter(([p]) => p !== platform)
    .flatMap(([p, markers]) =>
      markers
        .filter((m) => files.has(m))
        // `electron` (Linux) и `electron.exe` (Windows) — разные имена,
        // поэтому перепутанную сборку видно без догадок.
        .map((m) => `${p}:${m}`),
    );
  // UI26 R06: достаточно ОДНОГО файла чужой платформы, чтобы сборка считалась
  // смешанной и негодной — полный набор своих маркеров этого не оправдывает.
  return { ok: missing.length === 0 && foreign.length === 0, platform, missing, foreign };
}

/** Человеческое объяснение отказа — то, чего не хватало при `npm start`. */
export function explainFailure(result, distDir) {
  const lines = [`Electron для платформы "${result.platform}" не готов: ${path.join(distDir, '')}`];
  if (result.missing.length > 0) lines.push(`  отсутствуют: ${result.missing.join(', ')}`);
  if (result.foreign.length > 0) {
    lines.push(`  найдены файлы другой платформы: ${result.foreign.join(', ')}`);
    if (result.missing.length === 0) {
      lines.push('  → смешанная поставка: файлы двух платформ в одном каталоге недопустимы.');
    }
    lines.push('  → каталог заполнен сборкой ДРУГОЙ ОС (обычно WSL/Linux внутри Windows-checkout).');
  }
  lines.push(
    '',
    'Почему это важно: несовместимая сборка завершает процесс до создания окна',
    '(нет окна, нет ошибки в Application log), поэтому дефект выглядит как «тихий выход».',
    '',
    'Как исправить (любой вариант):',
    '  1. Windows-native установка: на Windows выполнить `npm ci` в этом checkout,',
    '     чтобы node_modules/electron содержал win32-сборку.',
    '  2. Явно указать Windows-сборку Electron:',
    '     PI_WS_DESKTOP_ELECTRON_EXE="F:\\\\path\\\\to\\\\electron.exe" npm run start:win',
    '  3. Проверить другой каталог вручную:',
    '     node scripts/check-electron-dist.mjs --platform win32 --dist <dir>',
  );
  return lines.join('\n');
}

/** Разбор аргументов; по умолчанию — текущая платформа и локальная поставка. */
export function parseArgs(argv, defaults) {
  const out = { platform: defaults.platform, dist: defaults.dist };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--platform') out.platform = argv[++i];
    else if (argv[i] === '--dist') out.dist = argv[++i];
  }
  return out;
}

function main() {
  const { platform, dist } = parseArgs(process.argv.slice(2), {
    platform: process.platform,
    dist: path.join(process.cwd(), 'node_modules', 'electron', 'dist'),
  });
  if (!fs.existsSync(dist)) {
    console.log(`Electron ещё не установлен (${dist}) — проверка платформы пропущена.`);
    return;
  }
  const result = verifyElectronDist(platform, fs.readdirSync(dist));
  if (result.ok) return;
  console.error(explainFailure(result, dist));
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
