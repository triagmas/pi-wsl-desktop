/**
 * UI-B R01 — эмулятор терминала для ОДНОЙ сессии.
 *
 * xterm.js рисует только реальный вывод PTY: ни одной выдуманной строки,
 * ни одной автоматически выполненной команды. Ввод уходит в main как base64,
 * размер — по факту fit'а в доке, клавиатура/фокус принадлежат xterm.
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { DesktopApi } from '../api';
import type { TerminalEvent, TerminalSession } from '../../shared/terminal';

export interface TerminalViewProps {
  api: DesktopApi;
  session: TerminalSession;
  /** Активная вкладка: fit + фокус; неактивная остаётся смонтированной (живой PTY). */
  active: boolean;
  onExit: (code: number | null, lost: boolean, message?: string) => void;
  onNotice: (message: string) => void;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** xterm возвращает IDisposable, тестовый двойник — функцию: принимаем оба. */
function disposeOf(disposable: unknown): void {
  if (typeof disposable === 'function') {
    (disposable as () => void)();
    return;
  }
  const candidate = disposable as { dispose?: () => void } | undefined;
  candidate?.dispose?.();
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function TerminalView({ api, session, active, onExit, onNotice }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);
  const exitRef = useRef(onExit);
  const noticeRef = useRef(onNotice);
  // Колбэки обновляем в эффекте: во время рендера ref трогать нельзя.
  useEffect(() => {
    exitRef.current = onExit;
    noticeRef.current = onNotice;
  }, [onExit, onNotice]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      scrollback: 4000,
      fontFamily: getComputedStyle(host).getPropertyValue('--pw-font-terminal-family').trim() || 'monospace',
      fontSize: 13,
      theme: { background: '#00000000' },
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      void api.terminal?.resize(session.id, cols, rows);
    });

    /**
     * Первый fit часто попадает в кадр, где контейнер ещё без размеров: тогда
     * PTY остаётся 80×24 и пользователь видит терминал не по ширине дока.
     * Поэтому пробуем трижды — сразу, в следующем кадре и после layout-паузы.
     */
    const attemptFit = (): void => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
      try {
        fit.fit();
      } catch {
        // размер ещё не стабилизировался — сработает ResizeObserver
      }
    };
    attemptFit();
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(attemptFit) : 0;
    const retryFit = setTimeout(attemptFit, 250);
    const retryFitLate = setTimeout(attemptFit, 800);
    // Явная синхронизация: даже если первый fit прошёл до подписки на onResize,
    // PTY получает фактический размер терминала сразу после открытия.
    void api.terminal?.resize(session.id, term.cols, term.rows);
    const dataDisposable = term.onData((data) => {
      void api.terminal?.write(session.id, toBase64(data));
    });
    setReady(true);

    let disposed = false;
    const offEvent = api.terminal?.onEvent((event: TerminalEvent) => {
      if (event.id !== session.id) return;
      if (event.type === 'data') {
        term.write(fromBase64(event.b64));
      } else if (event.type === 'notice') {
        noticeRef.current(event.message);
      } else if (event.type === 'exit') {
        exitRef.current(event.code, event.lost, event.message);
      }
    });

    // Подписка уже стоит — теперь просим main отдать накопленные ранние кадры
    // (приглашение/баннер) и стримить дальше без потерь.
    void Promise.resolve(api.terminal?.attach?.(session.id))
      .then((ok) => {
        // false — сессия уже завершилась, пока renderer подключался: честно
        // показываем это, а не пустой экран.
        if (ok === false && !disposed) {
          exitRef.current(null, true, 'сессия уже завершилась до подключения вывода');
        }
      })
      .catch(() => {
        // main недоступен — общий канал ошибок уже сообщит о разрыве
      });

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            try {
              fit.fit();
            } catch {
              // нулевой размер во время скрытия — не повод падать
            }
          });
    observer?.observe(host);
    const onWindowResize = () => {
      try {
        fit.fit();
      } catch {
        // см. выше
      }
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      disposed = true;
      clearTimeout(retryFit);
      clearTimeout(retryFitLate);
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      window.removeEventListener('resize', onWindowResize);
      observer?.disconnect();
      offEvent?.();
      disposeOf(resizeDisposable);
      disposeOf(dataDisposable);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [api, session.id]);

  useEffect(() => {
    if (!active) return;
    try {
      fitRef.current?.fit();
    } catch {
      // размер ещё не стабилизировался
    }
    termRef.current?.focus();
  }, [active, ready]);

  return <div className="dl-term-xterm" data-testid="terminal-xterm" ref={hostRef} />;
}
