/**
 * UI-B R01 — контракт терминала (shared: main, preload, renderer).
 *
 * Здесь только данные и правила: коды ошибок, пределы, валидация значений,
 * которые уходят в argv wsl.exe, и потоковый разбор кадров помощника.
 * Никакого Electron и node-специфичного API — модуль безопасно импортируется
 * из renderer.
 */

export const TERMINAL_LIMITS = {
  /** Больше вкладок не открываем: каждая — отдельный процесс wsl.exe + PTY. */
  maxSessions: 4,
  minCols: 2,
  maxCols: 400,
  defaultCols: 80,
  minRows: 1,
  maxRows: 200,
  defaultRows: 24,
  /** Кадр помощника (одна строка NDJSON) и буфер разбора. */
  maxFrameBytes: 1024 * 1024,
  /** Один write из renderer (нажатия клавиш/вставка). */
  maxWriteBytes: 64 * 1024,
  maxCwdLength: 4096,
  maxIdLength: 64,
  /**
   * Сколько событий сессии main держит, пока renderer не подключился
   * (`terminal:attach`). Иначе самые первые кадры PTY (приглашение, баннер
   * профиля) терялись: процесс стартует раньше, чем появляется обработчик.
   */
  maxBacklogBytes: 64 * 1024,
  maxBacklogFrames: 512,
} as const;

export type TerminalErrorCode =
  | 'TERMINAL_UNAVAILABLE'
  | 'TERMINAL_LIMIT'
  | 'TERMINAL_BAD_CWD'
  | 'TERMINAL_BAD_DISTRO'
  | 'TERMINAL_BAD_REQUEST'
  | 'TERMINAL_PROTOCOL';

/** Ошибка терминала: код стабилен, сообщение — для человека. */
export class TerminalError extends Error {
  constructor(
    public readonly code: TerminalErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'TerminalError';
  }
}

export interface TerminalOpenRequest {
  distro: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalSession {
  id: string;
  distro: string;
  cwd: string;
  cols: number;
  rows: number;
  pid: number | null;
}

export type TerminalEvent =
  | { type: 'ready'; id: string; pid: number | null; cwd: string }
  | { type: 'data'; id: string; b64: string }
  | { type: 'notice'; id: string; code: 'CWD_FALLBACK' | 'SHELL_FALLBACK'; message: string }
  | { type: 'exit'; id: string; code: number | null; lost: boolean; message?: string };

const DISTRO_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;

/** Имя дистрибутива WSL: буквы/цифры/точка/подчёркивание/дефис, до 64 символов. */
export function isSafeDistroName(value: unknown): value is string {
  return typeof value === 'string' && DISTRO_RE.test(value);
}

/**
 * cwd терминала — абсолютный POSIX-путь. Управляющие символы запрещены:
 * argv уходит в wsl.exe, а не в shell-строку, но мусор в пути всё равно
 * не должен доезжать до процесса.
 */
export function isSafeWslCwd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > TERMINAL_LIMITS.maxCwdLength) return false;
  if (!value.startsWith('/')) return false;
  return !/[\0\r\n]/.test(value);
}

/**
 * cwd терминала: пустая строка — «проекта нет». Это НЕ ошибка: помощник
 * откроет домашний каталог и пришлёт видимое объяснение (notice CWD_FALLBACK),
 * молчаливой подстановки нет.
 */
export function isTerminalCwd(value: unknown): value is string {
  return value === '' || isSafeWslCwd(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function clampCols(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n === null) return TERMINAL_LIMITS.defaultCols;
  return Math.min(TERMINAL_LIMITS.maxCols, Math.max(TERMINAL_LIMITS.minCols, Math.trunc(n)));
}

export function clampRows(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n === null) return TERMINAL_LIMITS.defaultRows;
  return Math.min(TERMINAL_LIMITS.maxRows, Math.max(TERMINAL_LIMITS.minRows, Math.trunc(n)));
}

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Строгий base64: пустая строка, «почти base64» и мусор не принимаются. */
export function isBase64(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return BASE64_RE.test(value);
}

/**
 * Потоковый декодер NDJSON. Кадры приходят кусками, поэтому буфер копится до
 * перевода строки; превышение лимита — ошибка протокола, а не рост памяти.
 */
export class FrameDecoder {
  private buffer = '';

  constructor(private readonly maxFrameBytes: number = TERMINAL_LIMITS.maxFrameBytes) {}

  push(chunk: string): Array<Record<string, unknown>> {
    this.buffer += chunk;
    if (this.buffer.length > this.maxFrameBytes) {
      this.buffer = '';
      throw new TerminalError('TERMINAL_PROTOCOL', 'кадр помощника превысил допустимый размер');
    }
    const frames: Array<Record<string, unknown>> = [];
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line !== '') {
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            frames.push(parsed as Record<string, unknown>);
          }
        } catch {
          // Битый кадр не должен ронять сессию: помощник пишет только свои кадры,
          // а мусор в stdout — повод его пропустить, не более.
        }
      }
      index = this.buffer.indexOf('\n');
    }
    return frames;
  }

  reset(): void {
    this.buffer = '';
  }
}
