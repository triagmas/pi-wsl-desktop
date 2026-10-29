/**
 * UI26 R07 (P1) — гейт приватности и селектор типов pre-commit.
 *
 * Проблема R06: хук объявлял `types: [text]`, поэтому бинарные контейнеры
 * ключей (`.p12`, `.pfx`, `.pem`) вообще не доходили до скрипта, и проверка
 * ИМЕНИ файла не выполнялась — «битый» коммит проходил гейт.
 *
 * Здесь два уровня:
 *  1) детерминированная проверка конфигурации и CLI (работает в CI);
 *  2) изолированный прогон `prek` в синтетическом git-репозитории (только если
 *     `uvx` доступен; иначе SKIP с явной причиной) — он показывает, что
 *     классификация `.p12` действительно доходит до хука при `types: [file]`
 *     и НЕ доходит при `types: [text]`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectFile } from '../../scripts/check-private-content.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG = path.join(REPO_ROOT, '.pre-commit-config.yaml');
const SCANNER = path.join(REPO_ROOT, 'scripts/check-private-content.mjs');

const hasUvx = spawnSync('uvx', ['--version'], { encoding: 'utf8' }).status === 0;

/** Блок хука `private-content` из рабочей конфигурации (без дублирования). */
function hookBlock(configText: string): string {
  const lines = configText.split(/\r?\n/);
  const start = lines.findIndex((l: string) => l.trim() === '- id: private-content');
  if (start < 0) throw new Error('в конфигурации нет хука private-content');
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && /^\s*-\s+id:/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function tempRepo(hookYaml: string, files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gate-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCANNER, path.join(dir, 'scripts', 'check-private-content.mjs'));
  fs.writeFileSync(path.join(dir, '.pre-commit-config.yaml'), `repos:\n  - repo: local\n    hooks:\n${hookYaml}\n`);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('add', '--', ...Object.keys(files));
  return dir;
}

const runPrek = (dir: string, files: string[]) =>
  spawnSync('uvx', ['prek', 'run', '--files', ...files], { cwd: dir, encoding: 'utf8', timeout: 180000 });

const BINARY_P12 = Buffer.from([0x30, 0x82, 0x03, 0x00, 0x02, 0x01, 0x03, 0x30, 0x82, 0x00, 0xff, 0x00, 0x01, 0x02]);

describe('P1: конфигурация хука не отсекает бинарные контейнеры ключей', () => {
  const config = () => fs.readFileSync(CONFIG, 'utf8');

  it('private-content объявлен с types: [file], а не [text]', () => {
    const block = hookBlock(config());
    expect(block).toContain('types: [file]');
    expect(block).not.toMatch(/types:\s*\[\s*text\s*\]/);
  });

  it('хук передаёт имена файлов (pass_filenames не отключён)', () => {
    expect(hookBlock(config())).not.toMatch(/pass_filenames:\s*false/);
  });

  it('имя ключевого контейнера проверяется ДО чтения содержимого', () => {
    const r = inspectFile('secret.p12', {
      statSync: () => ({ size: BINARY_P12.length }),
      readFileSync: () => 'не должен вызываться',
    });
    expect(r.ok).toBe(false);
    expect(r.findings[0].rule).toBe('filename:private-key-file');
  });
});

describe('P1: CLI блокирует бинарный .p12', () => {
  it('exit code 1 и явная причина', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gate-cli-'));
    const p12 = path.join(dir, 'secret.p12');
    fs.writeFileSync(p12, BINARY_P12);
    const r = spawnSync('node', [SCANNER, p12], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('filename:private-key-file');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('текстовый файл без секретов проходит', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gate-cli-'));
    const ok = path.join(dir, 'notes.ts');
    fs.writeFileSync(ok, 'export const x = 1;\n');
    expect(spawnSync('node', [SCANNER, ok], { encoding: 'utf8' }).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!hasUvx)('P1: изолированная классификация prek в синтетическом репозитории', () => {
  const hook = (types: string) => [
    '      - id: private-content',
    '        name: private gate',
    '        entry: node scripts/check-private-content.mjs',
    '        language: system',
    `        types: [${types}]`,
  ].join('\n');

  it('types: [file] — бинарный .p12 доходит до гейта и блокирует прогон', () => {
    const dir = tempRepo(hook('file'), { 'secret.p12': BINARY_P12, 'notes.txt': 'clean\n' });
    const r = runPrek(dir, ['secret.p12', 'notes.txt']);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('filename:private-key-file');
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/private gate\s*\.+\s*Passed/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('types: [text] — тот же файл молча проходит (RED-контрфакт для R06)', () => {
    const dir = tempRepo(hook('text'), { 'secret.p12': BINARY_P12, 'notes.txt': 'clean\n' });
    const r = runPrek(dir, ['secret.p12', 'notes.txt']);
    expect(r.status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('types: [file] — чистый текстовый файл проходит', () => {
    const dir = tempRepo(hook('file'), { 'notes.txt': 'clean\n' });
    expect(runPrek(dir, ['notes.txt']).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
