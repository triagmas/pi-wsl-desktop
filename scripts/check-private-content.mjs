/**
 * UI26 R05: быстрый локальный гейт против приватного содержимого.
 *
 * Публичный репозиторий не должен получать секреты, идентификаторы
 * провайдеров, реальные пути пользователя и дампы Pi-сессий. Правило уже есть
 * в CI (Repository Contract), здесь — тот же класс проверки для pre-commit,
 * чтобы дефект не доезжал до push.
 *
 * Паттерны собираются из фрагментов, чтобы файл не находил сам себя.
 * Использование: node scripts/check-private-content.mjs <files...>
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const FRAGMENTS = [
  ['cliproxy', 'api'],
  ['k', 'enari'],
  ['/home/', 'triag'],
  ['/mnt/f/', '_hermes'],
  ['01a1', '8005'],
  ['sk-', 'live_'],
  ['gh', 'p_[A-Za-z0-9]'],
];

/** Скомпилированные правила: {id, re}. Чистая функция для тестов. */
export function privatePatterns() {
  return FRAGMENTS.map(([a, b], i) => ({ id: `p${i}`, re: new RegExp(`${a}${b}`, 'i') }));
}

/** Первое совпадение в тексте; `null`, если чисто. */
export function findPrivate(text) {
  for (const { id, re } of privatePatterns()) {
    if (re.test(text)) return id;
  }
  return null;
}

const SKIP = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|exe|node|wasm|icns|pem|p12|pfx|key)$/i;

function main() {
  const files = process.argv.slice(2).filter((f) => !SKIP.test(f));
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // удалённые/бинарные файлы не интересны
    }
    const id = findPrivate(text);
    if (id) hits.push(`${file} (${id})`);
  }
  if (hits.length > 0) {
    console.error('Приватное содержимое в staged-файлах:');
    for (const h of hits) console.error(`  ${h}`);
    console.error('Реальные пути, идентификаторы провайдеров и дампы сессий публиковать нельзя.');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
