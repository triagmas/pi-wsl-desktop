/**
 * UI-B R01 — терминальный док центральной колонки с НАСТОЯЩИМ PTY.
 *
 * Раньше док был честно пустым («реальный PTY подключается в UI-B»). Теперь он
 * открывает реальный PTY в выбранном WSL-дистрибутиве, но по-прежнему:
 * — ничего не запускает при старте приложения (только явная кнопка/«+»);
 * — не выдумывает вывод: пустая сессия — пустой экран, пока PTY молчит;
 * — закрывает только свою вкладку/процесс, не трогая Pi-сессию и WSL целиком;
 * — при недоступном дистрибутиве честно объясняет, почему терминал не открыт.
 */
import { useCallback, useState } from 'react';
import { TerminalPane } from '../ui/TerminalPane';
import { TerminalView } from '../terminal/TerminalView';
import { useResizeHandle } from './useResizeHandle';
import type { DesktopApi } from '../api';
import type { TerminalSession } from '../../shared/terminal';
import { TERMINAL_LIMITS } from '../../shared/terminal';

export interface TerminalDockProps {
  /** Мост к main: без него терминал не открывается (fail closed). */
  api: DesktopApi | null;
  /** Выбранный WSL-дистрибутив (реальный snapshot подключения). */
  distro: string | null;
  /** Текущий проект: cwd терминала; null — домашний каталог (с объяснением). */
  cwd: string | null;
  height: number;
  onHeightPreview?: (height: number) => void;
  onHeightCommit?: (height: number) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClose?: () => void;
}

const TERM_MIN = 120;
const TERM_MAX = 600;

interface DockTab {
  key: string;
  status: 'opening' | 'live' | 'error';
  session: TerminalSession | null;
  notice?: string;
  ended?: { code: number | null; lost: boolean; message?: string };
  error?: string;
}

export function TerminalDock({
  api,
  distro,
  cwd,
  height,
  onHeightPreview,
  onHeightCommit,
  expanded = false,
  onToggleExpand,
  onClose,
}: TerminalDockProps) {
  const resize = useResizeHandle({
    axis: 'y',
    value: height,
    min: TERM_MIN,
    max: TERM_MAX,
    invert: true, // тянуть верхнюю границу вниз → док ниже (как drag мышью)
    onPreview: (h) => onHeightPreview?.(h),
    onCommit: (h) => onHeightCommit?.(h),
  });

  const [tabs, setTabs] = useState<DockTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Причина недоступности выводится из props, а не хранится в состоянии:
  // одно и то же условие не должно попадать в state через эффект.
  const availabilityError = !api?.terminal
    ? 'Терминал недоступен: мост к main-процессу не подключён'
    : !distro
      ? 'Терминал недоступен: не выбран дистрибутив WSL'
      : null;
  const localError = availabilityError ?? actionError;

  const patchTab = useCallback((key: string, patch: Partial<DockTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)));
  }, []);

  const openTab = useCallback(async () => {
    if (!api?.terminal) {
      setActionError('Терминал недоступен: мост к main-процессу не подключён');
      return;
    }
    if (!distro) {
      setActionError('Терминал недоступен: не выбран дистрибутив WSL');
      return;
    }
    if (tabs.length >= TERMINAL_LIMITS.maxSessions) {
      setActionError(`Открыто максимум ${TERMINAL_LIMITS.maxSessions} терминальных вкладок — закройте лишнюю`);
      return;
    }
    setActionError(null);
    const key = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setTabs((prev) => [...prev, { key, status: 'opening', session: null }]);
    setActiveKey(key);
    try {
      const session = await api.terminal.open({
        distro,
        cwd: cwd ?? '',
        cols: TERMINAL_LIMITS.defaultCols,
        rows: TERMINAL_LIMITS.defaultRows,
      });
      patchTab(key, { status: 'live', session });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchTab(key, { status: 'error', error: message });
    }
  }, [api, distro, cwd, tabs.length, patchTab]);

  const closeTab = useCallback(
    (key: string) => {
      const tab = tabs.find((item) => item.key === key);
      if (tab?.session) void api?.terminal?.close(tab.session.id);
      setTabs((prev) => {
        const next = prev.filter((item) => item.key !== key);
        if (activeKey === key) setActiveKey(next[next.length - 1]?.key ?? null);
        return next;
      });
    },
    [api, tabs, activeKey],
  );

  const selectTab = useCallback((key: string) => setActiveKey(key), []);

  return (
    <TerminalPane
      height={height}
      testid={{ dock: 'terminal-dock', slot: 'terminal-slot' }}
      live={tabs.length > 0}
      tabs={tabs.map((tab) => ({
        id: tab.key,
        label: `${distro ?? 'WSL'} · bash`,
        active: tab.key === activeKey,
        closable: true,
      }))}
      onSelectTab={selectTab}
      onCloseTab={closeTab}
      onAddTab={() => void openTab()}
      lines={[]}
      grip={
        <div
          className="dl-grip dl-resize dl-resize-y dl-resize-term"
          role="separator"
          aria-label="Высота терминала"
          aria-orientation="horizontal"
          aria-valuenow={height}
          aria-valuemin={TERM_MIN}
          aria-valuemax={TERM_MAX}
          tabIndex={0}
          data-testid="terminal-dock-resize"
          onMouseDown={resize.onMouseDown}
          onKeyDown={resize.onKeyDown}
        />
      }
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      onClose={onClose}
      body={
        <>
          {tabs.length === 0 ? (
            <div className="dl-term-empty">
              <span className="dl-term-note muted">
                Настоящий PTY в WSL — откроется по кнопке, команд само приложение не запускает.
              </span>
              <button
                type="button"
                className="dl-btn-ghost"
                data-testid="terminal-launch"
                onClick={() => void openTab()}
              >
                Открыть терминал
              </button>
              {localError ? (
                <span className="dl-term-note muted" role="status" data-testid="terminal-local-error">
                  {localError}
                </span>
              ) : null}
            </div>
          ) : null}

          {tabs.map((tab) => (
            <div
              key={tab.key}
              className="dl-term-session"
              data-testid={`terminal-session-${tab.key}`}
              hidden={tab.key !== activeKey}
            >
              {tab.status === 'opening' ? (
                <span className="dl-term-note muted" data-testid="terminal-status">
                  Запуск PTY в WSL…
                </span>
              ) : null}
              {tab.status === 'error' ? (
                <span className="dl-term-note" role="alert" data-testid="terminal-status">
                  {tab.error ?? 'Терминал не открылся'}
                </span>
              ) : null}
              {tab.status === 'live' && tab.session && api?.terminal ? (
                <>
                  {tab.notice ? (
                    <span className="dl-term-note" role="status" data-testid="terminal-notice">
                      {tab.notice}
                    </span>
                  ) : null}
                  {tab.ended ? (
                    <span className="dl-term-note" role="status" data-testid="terminal-status">
                      Терминал завершён{tab.ended.code !== null ? ` (код ${tab.ended.code})` : ''}
                      {tab.ended.lost ? ' — соединение потеряно' : ''}
                      {tab.ended.message ? `: ${tab.ended.message}` : ''}
                    </span>
                  ) : null}
                  <TerminalView
                    api={api}
                    session={tab.session}
                    active={tab.key === activeKey}
                    onExit={(code, lost, message) => patchTab(tab.key, { ended: { code, lost, message } })}
                    onNotice={(message) => patchTab(tab.key, { notice: message })}
                  />
                </>
              ) : null}
            </div>
          ))}

          {localError && tabs.length > 0 ? (
            <span className="dl-term-note" role="status" data-testid="terminal-local-error">
              {localError}
            </span>
          ) : null}
        </>
      }
    />
  );
}
