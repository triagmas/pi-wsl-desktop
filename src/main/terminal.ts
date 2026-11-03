/**
 * UI-B R01 — менеджер терминальных сессий (main-процесс).
 *
 * Каждая сессия — отдельный процесс `wsl.exe -d <distro> --exec python3 …`
 * со своим PTY внутри дистрибутива. Терминал не связан с Pi RPC: падение
 * терминала не трогает Pi-сессию, а терминал не умеет вызывать методы Pi.
 *
 * Границы: значения из renderer валидируются (distro/cwd/размеры/base64),
 * лимит сессий и кадра, уважение к чужим процессам (закрываем только своё),
 * честные события ready/data/notice/exit вместо фиктивного вывода.
 */
import { randomUUID } from 'node:crypto';
import {
  FrameDecoder,
  TERMINAL_LIMITS,
  TerminalError,
  clampCols,
  clampRows,
  isBase64,
  isSafeDistroName,
  isTerminalCwd,
  type TerminalEvent,
  type TerminalOpenRequest,
  type TerminalSession,
} from '../shared/terminal';
import { buildPtyArgv } from './ptyHelper';

export interface TerminalChild {
  pid?: number;
  stdin: { write(chunk: string): boolean; end(): void };
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): unknown; setEncoding?(encoding: string): void };
  stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown };
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnLike = (command: string, args: string[], options: { stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean }) => TerminalChild;

export interface TerminalManagerOptions {
  spawn: SpawnLike;
  onEvent: (event: TerminalEvent) => void;
  wslPath?: string;
  pythonPath?: string;
  shell?: string;
  maxSessions?: number;
  /** Сколько ждать добровольного выхода после close, прежде чем убить процесс. */
  killGraceMs?: number;
  idFactory?: () => string;
}

interface Entry {
  session: TerminalSession;
  child: TerminalChild;
  decoder: FrameDecoder;
  closing: boolean;
  finished: boolean;
  killTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_KILL_GRACE_MS = 1500;

export class TerminalManager {
  private readonly entries = new Map<string, Entry>();
  private readonly spawn: SpawnLike;
  private readonly onEvent: (event: TerminalEvent) => void;
  private readonly wslPath: string;
  private readonly pythonPath: string;
  private readonly shell: string;
  private readonly maxSessions: number;
  private readonly killGraceMs: number;
  private readonly idFactory: () => string;

  constructor(options: TerminalManagerOptions) {
    this.spawn = options.spawn;
    this.onEvent = options.onEvent;
    this.wslPath = options.wslPath ?? 'C:\\Windows\\System32\\wsl.exe';
    this.pythonPath = options.pythonPath ?? 'python3';
    this.shell = options.shell ?? '/bin/bash';
    this.maxSessions = options.maxSessions ?? TERMINAL_LIMITS.maxSessions;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.idFactory = options.idFactory ?? (() => randomUUID().slice(0, 8));
  }

  sessions(): TerminalSession[] {
    return [...this.entries.values()].map((entry) => entry.session);
  }

  size(): number {
    return this.entries.size;
  }

  /** Открывает новую сессию. Ошибки — TerminalError с кодом для renderer. */
  open(request: TerminalOpenRequest): TerminalSession {
    if (!isSafeDistroName(request?.distro)) {
      throw new TerminalError('TERMINAL_BAD_DISTRO', `недопустимое имя дистрибутива: ${String(request?.distro)}`);
    }
    if (!isTerminalCwd(request?.cwd)) {
      throw new TerminalError('TERMINAL_BAD_CWD', `недопустимый путь проекта: ${String(request?.cwd)}`);
    }
    if (this.entries.size >= this.maxSessions) {
      throw new TerminalError('TERMINAL_LIMIT', `уже открыто ${this.maxSessions} терминальных сессий`);
    }

    const cols = clampCols(request.cols);
    const rows = clampRows(request.rows);
    const args = buildPtyArgv({
      distro: request.distro,
      cwd: request.cwd,
      cols,
      rows,
      pythonPath: this.pythonPath,
      shell: this.shell,
    });

    const session: TerminalSession = {
      id: this.idFactory(),
      distro: request.distro,
      cwd: request.cwd,
      cols,
      rows,
      pid: null,
    };

    let child: TerminalChild;
    try {
      child = this.spawn(this.wslPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      throw new TerminalError(
        'TERMINAL_UNAVAILABLE',
        `не удалось запустить wsl.exe: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const entry: Entry = { session, child, decoder: new FrameDecoder(), closing: false, finished: false, killTimer: null };
    this.entries.set(session.id, entry);

    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', (chunk) => this.onStdout(entry, chunk));
    child.on('error', (err) => {
      this.finish(entry, {
        type: 'exit',
        id: session.id,
        code: null,
        lost: !entry.closing,
        message: `TERMINAL_UNAVAILABLE: ${err.message}`,
      });
      this.killEntry(entry);
    });
    child.on('exit', (code) => {
      this.finish(entry, {
        type: 'exit',
        id: session.id,
        code: entry.closing ? null : code,
        lost: !entry.closing,
        ...(entry.closing ? {} : { message: 'терминальный процесс завершился неожиданно' }),
      });
    });

    return session;
  }

  write(id: string, dataB64: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.finished || entry.closing) return false;
    if (!isBase64(dataB64)) return false;
    if (Buffer.byteLength(dataB64, 'base64') > TERMINAL_LIMITS.maxWriteBytes) return false;
    return this.send(entry, { t: 'in', d: dataB64 });
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.finished || entry.closing) return;
    const nextCols = clampCols(cols);
    const nextRows = clampRows(rows);
    if (nextCols === entry.session.cols && nextRows === entry.session.rows) return;
    entry.session = { ...entry.session, cols: nextCols, rows: nextRows };
    this.send(entry, { t: 'resize', c: nextCols, r: nextRows });
  }

  /** Закрывает только эту сессию: SIGHUP своему PTY, без глобальных команд WSL. */
  close(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.finished) return;
    entry.closing = true;
    this.send(entry, { t: 'close' });
    this.endStdin(entry);
    if (entry.killTimer) clearTimeout(entry.killTimer);
    entry.killTimer = setTimeout(() => {
      this.finish(entry, { type: 'exit', id, code: null, lost: false });
      this.killEntry(entry);
    }, this.killGraceMs);
  }

  /**
   * Закрытие приложения: только собственные процессы терминала. Приложение уже
   * завершается, поэтому ждать добровольного выхода бессмысленно — сообщаем
   * close и сразу снимаем сессию, не трогая WSL глобально.
   */
  disposeAll(): void {
    for (const entry of [...this.entries.values()]) {
      entry.closing = true;
      this.send(entry, { t: 'close' });
      this.endStdin(entry);
      this.finish(entry, { type: 'exit', id: entry.session.id, code: null, lost: false });
      this.killEntry(entry);
    }
  }

  /**
   * Закрывает stdin помощника: EOF для него равен «закрыть PTY». Так процесс
   * освобождает файловые дескрипторы сам, а не только через SIGKILL по таймеру.
   */
  private endStdin(entry: Entry): void {
    try {
      entry.child.stdin.end();
    } catch {
      // процесс уже завершился — освобождать нечего
    }
  }

  private send(entry: Entry, frame: Record<string, unknown>): boolean {
    try {
      entry.child.stdin.write(`${JSON.stringify(frame)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  private onStdout(entry: Entry, chunk: unknown): void {
    if (entry.finished) return;
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    let frames: Array<Record<string, unknown>>;
    try {
      frames = entry.decoder.push(text);
    } catch (err) {
      const message = err instanceof TerminalError ? err.message : 'TERMINAL_PROTOCOL: нечитаемый кадр помощника';
      this.finish(entry, { type: 'exit', id: entry.session.id, code: null, lost: true, message });
      this.killEntry(entry);
      return;
    }
    for (const frame of frames) {
      if (entry.finished) return;
      this.dispatch(entry, frame);
    }
  }

  private dispatch(entry: Entry, frame: Record<string, unknown>): void {
    const id = entry.session.id;
    switch (frame.t) {
      case 'ready': {
        const pid = typeof frame.pid === 'number' && Number.isFinite(frame.pid) ? frame.pid : null;
        entry.session = { ...entry.session, pid };
        this.onEvent({ type: 'ready', id, pid, cwd: typeof frame.cwd === 'string' ? frame.cwd : entry.session.cwd });
        return;
      }
      case 'out': {
        if (typeof frame.d !== 'string' || frame.d.length === 0) return;
        this.onEvent({ type: 'data', id, b64: frame.d });
        return;
      }
      case 'notice': {
        const code = frame.code === 'CWD_FALLBACK' || frame.code === 'SHELL_FALLBACK' ? frame.code : 'CWD_FALLBACK';
        this.onEvent({
          type: 'notice',
          id,
          code,
          message: typeof frame.message === 'string' ? frame.message : 'терминал изменил окружение',
        });
        return;
      }
      case 'exit': {
        const code = typeof frame.code === 'number' && Number.isFinite(frame.code) ? frame.code : null;
        this.finish(entry, { type: 'exit', id, code, lost: false });
        return;
      }
      default:
        // Неизвестный кадр игнорируем: помощник может расширяться, контракт — стабилен.
        return;
    }
  }

  private finish(entry: Entry, event: TerminalEvent): void {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.killTimer) {
      clearTimeout(entry.killTimer);
      entry.killTimer = null;
    }
    this.entries.delete(entry.session.id);
    this.onEvent(event);
  }

  private killEntry(entry: Entry): void {
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // процесс уже умер — ничего не делаем
    }
  }
}
