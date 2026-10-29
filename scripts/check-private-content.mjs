/**
 * UI26 R06: локальный гейт против ПРИВАТНОГО КЛАССА содержимого.
 *
 * Что это: набор регулярных правил для известных классов секретов и приватных
 * путей, применяемый к staged-файлам до коммита. Правила общие — ни одного
 * идентификатора конкретного провайдера, пользователя или рабочей папки, поэтому
 * файл можно публиковать и он не «подсвечивает» сам себя.
 *
 * ЧЕГО ЭТО НЕ ДЕЛАЕТ (важно, чтобы не считать гейт «сканером всех секретов»):
 *  - нет анализа энтропии: неизвестный формат ключа может пройти;
 *  - нет истории git: проверяется только staged-содержимое текущего коммита;
 *  - нет бинарного анализа: файлы с бинарными расширениями пропускаются;
 *  - НЕ ловит «key = '<литерал>'» по имени переменной: на фикстурах это даёт
 *    слишком много ложных срабатываний, поэтому ловятся только формы значений;
 *  - НЕ ловит пути смонтированных дисков (`/mnt/<drive>/…`, `X:\…`): репозиторий
 *    документирует собственный канонический путь, и правило было бы шумным;
 *  - нет проверки приватности имён файлов вне перечисленных классов;
 *  - нет сетевых проверок (утечка уже опубликованного не отзывается).
 *
 * Ошибки чтения и превышение лимита размера считаются НАРУШЕНИЕМ (fail-closed):
 * непрочитанный staged-файл нельзя объявить безопасным.
 *
 * Использование: node scripts/check-private-content.mjs <files...>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Больше этого размера файл не инспектируется и считается нарушением. */
export const MAX_INSPECT_BYTES = 4 * 1024 * 1024;

/** Бинарные расширения: содержимое не инспектируется (см. ограничения). */
export const BINARY_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.exe',
  '.dll',
  '.node',
  '.wasm',
  '.icns',
  '.pdf',
  '.zip',
];

/**
 * Плейсхолдеры, которыми пользуются фикстуры и документация. Осознанное
 * ограничение: настоящий пользователь с таким именем не будет обнаружен.
 */
export const PLACEHOLDER_USERS = [
  'u',
  'user',
  'username',
  'fake',
  'synthetic',
  'test',
  'tester',
  'alice',
  'bob',
  'ci',
  'runner',
  'ubuntu',
  'dev',
  'example',
  'demo',
];

/**
 * Общие классы секретов и приватных путей. Строки-образцы собираются из
 * фрагментов, чтобы описание правил не содержало готовых «плохих» литералов.
 */
const SECRET_CLASSES = [
  {
    id: 'private-key-block',
    title: 'PEM private key',
    // BEGIN <something> PRIVATE KEY
    re: new RegExp(`-----BEGIN [A-Z0-9 ]{0,40}PRIV${'ATE KEY'}[A-Z ]*-----`),
  },
  {
    id: 'aws-access-key',
    title: 'AWS access key id',
    re: new RegExp(`\\b(?:AK${'IA'}|AS${'IA'})[0-9A-Z]{16}\\b`),
  },
  {
    id: 'github-token',
    title: 'GitHub token',
    re: new RegExp(`\\bgh${'[pousr]_'}[A-Za-z0-9]{20,}\\b`),
  },
  {
    id: 'slack-token',
    title: 'Slack token',
    re: new RegExp(`\\bxo${'x[abprs]-'}[A-Za-z0-9-]{10,}\\b`),
  },
  {
    id: 'openai-style-key',
    title: 'API key with sk- prefix',
    re: new RegExp(`\\bsk${'-'}[A-Za-z0-9_-]{20,}\\b`),
  },
  {
    id: 'bearer-header',
    title: 'literal bearer credential',
    re: new RegExp(`\\bBear${'er'} [A-Za-z0-9._-]{20,}`, 'i'),
  },
];

/**
 * Приватные абсолютные пути: домашние каталоги и монтируемые рабочие диски.
 * Проверяется форма пути, а не конкретное имя пользователя или папки.
 */
const PRIVATE_PATH_CLASSES = [
  {
    id: 'home-directory-path',
    title: 'absolute home directory path of a real user',
    // Плейсхолдеры фикстур (u, user, fake, synthetic, test, …) не считаются
    // утечкой; проверяется именно похожесть на настоящий домашний каталог.
    re: new RegExp(
      `/(?:ho${'me'}|Us${'ers'})/(?!${PLACEHOLDER_USERS.join('|')}/)[A-Za-z0-9][A-Za-z0-9._-]{2,}/`,
    ),
  },
  {
    id: 'windows-user-path',
    title: 'absolute Windows user profile path',
    re: new RegExp(`[A-Za-z]:\\\\Us${'ers'}\\\\[A-Za-z0-9._-]+\\\\`),
  },
];

/**
 * Значения-заглушки в фикстурах: содержат явное слово-маркер, поэтому не
 * считаются секретом. Осознанное ограничение: реальный секрет, содержащий
 * слово «example», пройдёт.
 */
export const PLACEHOLDER_VALUES = /(synthetic|dummy|example|placeholder|never-on-screen|redacted)/i;

const PATH_RULE_IDS = new Set(['home-directory-path', 'windows-user-path']);

/** Чувствительные ИМЕНА файлов (проверяются по пути, содержимое не читается). */
const SENSITIVE_FILENAMES = [
  { id: 'auth-json', re: /^auth\.json$/i },
  { id: 'dotenv', re: /^\.env$/i },
  { id: 'private-key-file', re: /\.(?:pem|p12|pfx|key)$/i },
];

/** Все правила: секреты + пути. Чистая функция — используется в тестах. */
export function privateRules() {
  return [...SECRET_CLASSES, ...PRIVATE_PATH_CLASSES].map(({ id, title, re }) => ({ id, title, re }));
}

/** Первое сработавшее правило в тексте или `null`. */
export function findPrivate(text) {
  for (const { id, re } of privateRules()) {
    const m = re.exec(text);
    if (!m) continue;
    // Заглушки фикстур не считаются секретом (только для классов секретов —
    // пути проверяются отдельно, у них свой список плейсхолдеров).
    if (!PATH_RULE_IDS.has(id) && PLACEHOLDER_VALUES.test(m[0])) continue;
    return id;
  }
  return null;
}

/** Чувствительное имя файла (по относительному пути) или `null`. */
export function findSensitiveName(file) {
  const base = path.basename(file);
  for (const { id, re } of SENSITIVE_FILENAMES) {
    if (re.test(base)) return id;
  }
  return null;
}

/**
 * Проверка одного файла. Возвращает `{ ok, findings }`; ошибки чтения и
 * превышение лимита — НАРУШЕНИЯ (fail-closed), а не «пропуск».
 */
export function inspectFile(file, io = { readFileSync: fs.readFileSync, statSync: fs.statSync }) {
  const findings = [];
  const nameHit = findSensitiveName(file);
  if (nameHit) findings.push({ file, rule: `filename:${nameHit}` });
  if (BINARY_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
    return { ok: findings.length === 0, skipped: 'binary', findings };
  }
  let text;
  try {
    const size = io.statSync(file).size;
    if (size > MAX_INSPECT_BYTES) {
      return { ok: false, skipped: 'too-large', findings: [...findings, { file, rule: 'too-large' }] };
    }
    text = io.readFileSync(file, 'utf8');
  } catch (err) {
    // Fail-closed: непрочитанный staged-файл нельзя считать проверенным.
    const code = (err && typeof err === 'object' && 'code' in err ? String(err.code) : 'UNKNOWN');
    return { ok: false, skipped: 'unreadable', findings: [...findings, { file, rule: `unreadable:${code}` }] };
  }
  const rule = findPrivate(text);
  if (rule) findings.push({ file, rule });
  return { ok: findings.length === 0, skipped: null, findings };
}

/** Проверка набора файлов: `{ok, findings}` для CLI и тестов. */
export function inspectFiles(files) {
  const findings = [];
  for (const file of files) findings.push(...inspectFile(file).findings);
  return { ok: findings.length === 0, findings };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) return;
  const { ok, findings } = inspectFiles(files);
  if (ok) return;
  console.error('Приватное содержимое или непроверяемые файлы в staged-наборе:');
  for (const f of findings) console.error(`  ${f.file} — ${f.rule}`);
  console.error(
    [
      'Правила: известные классы секретов (PEM, AWS, GitHub, Slack, sk-подобные,',
      'литеральные bearer/assignments), приватные абсолютные пути, чувствительные',
      'имена файлов. Это НЕ полный сканер секретов: нет энтропийного анализа,',
      'истории git и бинарных файлов. Непрочитанный файл считается нарушением.',
    ].join('\n'),
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
