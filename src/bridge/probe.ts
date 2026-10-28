/**
 * Read-only Pi discovery inside WSL.
 *
 * Order: PI_WS_DESKTOP_PI override → ~/.local/bin/pi (user install) → PATH.
 * Runs only bounded, non-interactive commands (`pi --version`, `pi --help`)
 * with hard timeouts; never launches a session, model call or interactive
 * startup script.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  PI_HELP_FALLBACK_TIMEOUT_MS,
  PI_MODE_PROBE_TIMEOUT_MS,
  PI_RPC_PROBE_BUDGET_MS,
  PI_VERSION_PROBE_TIMEOUT_MS,
} from '../shared/timeouts';

export interface PiProbe {
  path: string;
  version: string;
  rpcSupported: boolean;
  /**
   * Трёхзначный вердикт пробы (UI21 F1-B Startup Gate R01):
   * - `supported`   — `pi` сам подтвердил наличие режима rpc (разбор argv);
   * - `unsupported` — доказано, что rpc-режима нет → строгий отказ;
   * - `unknown`     — пробу сорвало (тайм-аут/PATH/сбой спавна). Это НЕ
   *   несовместимость: рабочий Pi не должен отвергаться из-за медленного
   *   или сорванного probe.
   */
  rpcStatus: RpcStatus;
}

export type RpcStatus = 'supported' | 'unsupported' | 'unknown';

/**
 * Несуществующий (заведомо) режим для дешёвой окончательной проверки.
 * `pi --mode <этот> --help` заставляет CLI разобрать argv, перечислить
 * допустимые режимы и выйти — сессия не стартует, модель не вызывается.
 */
export const RPC_PROBE_MODE = '__pi_desktop_probe__';

/**
 * Бюджеты пробы (единственный источник истины — src/shared/timeouts.ts):
 * дешёвая проверка режима — единицы миллисекунд; резервный `--help` получает
 * больше времени, потому что холодный DrvFs-старт Pi доходит до ~18 с.
 */
export const MODE_PROBE_TIMEOUT_MS = PI_MODE_PROBE_TIMEOUT_MS;
export const HELP_FALLBACK_TIMEOUT_MS = PI_HELP_FALLBACK_TIMEOUT_MS;
/** Худший случай одной пробы: version + режим + help. Гейт соединения ждёт дольше. */
export const RPC_PROBE_BUDGET_MS = PI_RPC_PROBE_BUDGET_MS;

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (
  command: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<SpawnResult>;

export const defaultSpawn: SpawnFn = (command, args, opts) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout: string;
    let stderr: string;
    // Byte-faithful accumulation (review round 4): decode ONCE at exit so a
    // multibyte char straddling a stream chunk boundary is never corrupted.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`spawn timed out after ${opts.timeoutMs}ms: ${command}`));
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdoutChunks.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderrChunks.push(d);
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      stdout = Buffer.concat(stdoutChunks).toString('utf8');
      stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({ code, stdout, stderr });
    });
  });

const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/;

/**
 * PATH for spawning Pi itself: candidates may be `#!/usr/bin/env node`
 * scripts (the real ~/.local/bin/pi is), so node must resolve — the bridge's
 * own node directory, the user's ~/.local/bin, then system dirs. Shared by
 * probing AND the RPC chat spawn so both see identical resolution.
 */
export function buildProbePath(home: string): string {
  return [
    path.dirname(process.execPath),
    home ? path.posix.join(home, '.local', 'bin') : '',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
    .filter(Boolean)
    .join(':');
}

function candidatePaths(env: NodeJS.ProcessEnv, home: string): string[] {
  // An explicit PI_WS_DESKTOP_PI override is authoritative in BOTH
  // directions: when set it is the ONLY candidate probed — a broken override
  // yields PI_NOT_FOUND instead of silently falling back to a different pi
  // (deterministic tests, honest user directive).
  if (env.PI_WS_DESKTOP_PI) return [env.PI_WS_DESKTOP_PI];
  const list: string[] = [];
  if (home) list.push(path.posix.join(home, '.local', 'bin', 'pi'));
  for (const dir of (env.PATH ?? '').split(':')) {
    if (dir) list.push(path.posix.join(dir, 'pi'));
  }
  return [...new Set(list)];
}

export async function probePi(
  opts: { env?: NodeJS.ProcessEnv; home?: string; spawnFn?: SpawnFn; timeoutMs?: number } = {},
): Promise<PiProbe | null> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? env.HOME ?? '';
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const versionMs = opts.timeoutMs ?? PI_VERSION_PROBE_TIMEOUT_MS;
  // Дешёвая проверка режима ограничена коротким бюджетом (ARGV-разбор — это
  // единицы миллисекунд); `--help` — только резерв, и ему даётся больше
  // времени, потому что холодный DrvFs-старт Pi доходит до ~18 с.
  // Сумма бюджетов (5 + 20 с) должна укладываться в гейт-бюджет соединения
  // (см. GATE_REQUEST_MS в src/main/connection.ts), иначе резерв не успеет.
  const modeMs = Math.min(versionMs, MODE_PROBE_TIMEOUT_MS);
  const helpMs = Math.max(versionMs, HELP_FALLBACK_TIMEOUT_MS);
  const childEnv = { PATH: buildProbePath(home) };

  for (const candidate of candidatePaths(env, home)) {
    let versionOut: SpawnResult;
    try {
      versionOut = await spawnFn(candidate, ['--version'], { env: childEnv, timeoutMs: versionMs });
    } catch {
      continue; // unreadable, not executable or hung → next candidate
    }
    if (versionOut.code !== 0) continue;
    const match = VERSION_RE.exec(versionOut.stdout);
    if (!match) continue;

    const rpcStatus = await probeRpc(candidate, spawnFn, childEnv, { modeMs, helpMs });
    return { path: candidate, version: match[1], rpcSupported: rpcStatus === 'supported', rpcStatus };
  }
  return null;
}

const MODE_LIST_RE = /Valid values:\s*([^\n\r]*)/i;

/** «Valid values: text, json, rpc» → ['text','json','rpc']; null — списка нет. */
function parseModeList(text: string): string[] | null {
  const hit = MODE_LIST_RE.exec(text);
  if (!hit) return null;
  const modes = hit[1]
    .split(/[,|/\s]+/)
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return modes.length > 0 ? modes : null;
}

/**
 * Доказательство RPC без запуска сессии (UI21 F1-B R01).
 *
 * 1) `pi --mode <bogus> --help`: CLI сам перечисляет допустимые режимы и
 *    выходит с кодом 1. Разбор argv — доказательство того, что установленный
 *    Pi умеет режим rpc, без скрейпа большого help-текста и без запуска.
 * 2) Резерв — `pi --help` c увеличенным бюджетом, только если (1) ничего не
 *    доказал (старый Pi игнорирует неизвестный --mode и печатает help).
 * 3) Всё, что не доказано (тайм-аут, сбой спавна, непонятный вывод) —
 *    `unknown`, а не «не поддерживает RPC».
 */
async function probeRpc(
  candidate: string,
  spawnFn: SpawnFn,
  env: NodeJS.ProcessEnv,
  budget: { modeMs: number; helpMs: number },
): Promise<RpcStatus> {
  try {
    const out = await spawnFn(candidate, ['--mode', RPC_PROBE_MODE, '--help'], {
      env,
      timeoutMs: budget.modeMs,
    });
    const modes = parseModeList(`${out.stderr}\n${out.stdout}`);
    // Окончательно только когда CLI ЗАВЕРШИЛСЯ С КОДОМ и перечислил режимы.
    // code === null — процесс убит сигналом (тайм-аут/KILL): вывод мог быть
    // обрезан на полуслове («… text, json, rp»), поэтому вердикта нет.
    const completed = typeof out.code === 'number' && out.code !== 0;
    if (modes && completed) return modes.includes('rpc') ? 'supported' : 'unsupported';
  } catch {
    // тайм-аут/сбой спавна → не доказано, идём в резерв
  }

  try {
    const help = await spawnFn(candidate, ['--help'], { env, timeoutMs: budget.helpMs });
    // Успешно отпечатанный help (именно код 0, не «не 0» и не null от сигнала)
    // — окончательный вердикт: либо в нём есть режим rpc, либо режима нет.
    if (help.code === 0) {
      const text = `${help.stdout}\n${help.stderr}`;
      return /--mode/.test(text) && /\brpc\b/.test(text) ? 'supported' : 'unsupported';
    }
  } catch {
    // транзиентный сбой — вердикта нет
  }
  return 'unknown';
}
