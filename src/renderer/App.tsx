import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './index.css';
import { getDesktopApi, type DesktopApi } from './api';
import { phaseText } from './StatusPanel';
import { HistoryView } from './HistoryView';
import { ChatPane } from './ChatPane';
import { ResourcesView } from './ResourcesView';
import { ModulesView } from './ModulesView';
import { SettingsView } from './SettingsView';
import { ModulePanel } from './ModulePanel';
import { ModuleTabView } from './ModuleTabView';
import type { ModuleAction } from '../shared/m3Protocol';
import { ListModulesResultSchema } from '../shared/m3Ipc';
import { useConnection } from './useConnection';
import { useChat } from './useChat';
import { DEMO_MODULE_MANIFEST } from './modules/demoModule';
import {
  modulePanels,
  moduleTabs,
  registerModules,
  setModuleEnabled,
  type ModuleEntry,
} from './modules/registry';
import { LeftSidebar } from './shell/LeftSidebar';
import { RightSidebar, RightSidebarHead, RightSidebarResize } from './shell/RightSidebar';
import { TerminalDock } from './shell/TerminalDock';
import { AppScreen } from './ui/AppScreen';
import { ChatView } from './ui/ChatView';
import { SessionTabs } from './ui/SessionTabs';
import { IconPanelExpand } from './ui/icons';
import { applyTheme } from './design/applyTheme';
import { applyTypography } from './design/applyTypography';
import { THEME_PRESETS } from '../shared/design/presets';
import { DEFAULT_APPEARANCE, migrateAppearance, type AppearanceSettings } from '../shared/appearance';
import { m1 } from './m1api';
import type { SessionInfoT } from './types';

export interface AppProps {
  /** Injectable for tests; by default the preload contextBridge API is used. */
  api?: DesktopApi | null;
  /**
   * M3: raw module manifests to register. Injectable for tests; the default
   * registers the built-in demo module. Adding a module here (or later from a
   * catalog) never requires patching this component.
   */
  moduleDefinitions?: unknown[];
}

type View = 'chat' | 'resources' | 'modules' | 'settings' | `module:${string}`;

const RIGHT_PANEL_MIN = 240;
const RIGHT_PANEL_MAX = 560;
const LEFT_MIN = 200;
const LEFT_MAX = 480;

export function App({ api, moduleDefinitions }: AppProps = {}) {
  const effectiveApi = api === undefined ? getDesktopApi() : api;
  const { snapshot, requestError, connectionSeq, retry, selectDistro, refreshRuntime } = useConnection(effectiveApi);
  /** §9.6 step 2: chat is the default workspace (details of the base screen). */
  const [view, setView] = useState<View>('chat');
  /** D3: режим сессии (История | Чат) — кнопки в общей crumb-row AppScreen.
   * Derived-состояние (без setState-in-effect): режим, сохранённый для ДРУГОЙ
   * сессии, игнорируется — новая сессия всегда открывается в «Истории», как и
   * прежний remount ChatWorkspace со своим локальным tab-state. */
  const [sessionTabState, setSessionTabState] = useState<{
    file: string | null;
    tab: 'history' | 'chat';
  }>({ file: null, tab: 'history' });
  // M3 module registry: registered once from the definitions, then toggled.
  const [moduleEntries, setModuleEntries] = useState<ModuleEntry[]>(() =>
    registerModules(moduleDefinitions ?? [DEMO_MODULE_MANIFEST]),
  );
  /** R04: bounded discovery/persistence problems, shown honestly in Modules. */
  const [loadDiagnostics, setLoadDiagnostics] = useState<string[]>([]);
  const [persistError, setPersistError] = useState<string | null>(null);
  /**
   * Review #1: discovery is keyed to the CONNECTION lifecycle, not mount —
   * `WslConnection.request` rejects before `ready`, and a distro switch must
   * reload the registry/persistence for the NEW environment (stale results
   * are cancelled by the effect cleanup). 'error' still runs the request so
   * the failure surfaces as visible diagnostics instead of a silent spinner.
   */
  // `connectionSeq` is monotonic across reconnects (review N1): attempt alone
  // resets to 0 on every READY and would let the key repeat.
  const readyKey = !effectiveApi
    ? 'no-api'
    : snapshot.phase === 'ready' && snapshot.distro !== null
      ? `ready:${snapshot.distro}:${snapshot.attempt}:${connectionSeq}`
      : snapshot.phase === 'error'
        ? `error:${snapshot.attempt}:${connectionSeq}`
        : 'wait';
  /** Review #6: toggles stay disabled until discovery settles (no lost toggles).
   * Derived (no sync setState in the effect): loading = the connection key we
   * last finished a discovery for is not the current one. It flips true
   * automatically on connect, distro switch and disconnect. */
  const [discoveredKey, setDiscoveredKey] = useState<string | null>(null);
  const modulesLoading =
    moduleDefinitions === undefined &&
    effectiveApi !== null &&
    discoveredKey !== readyKey;
  /** Review #6: last server-confirmed enabled state per module (revert target). */
  const confirmedRef = useRef(new Map<string, boolean>());
  /** Review #6: per-module persistence lock — one write op in flight at a time. */
  const [persistingIds, setPersistingIds] = useState<ReadonlySet<string>>(new Set());

  /* ------------------------------------------------------------------ *
   * Appearance (§9.1 item 5): loaded once, applied live, saved on change.
   * Lives at the composition root so panels can be remounted at will.
   * ------------------------------------------------------------------ */
  const [appearance, setAppearance] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  /** No API (tests/no preload) ⇒ defaults are already the final state. */
  const appearanceReady = appearanceLoaded || effectiveApi === null;
  const saveAppearanceRef = useRef<ReturnType<DesktopApi['saveAppearance']> | null>(null);
  /** Review P1-4: layout-жесты ДО завершения загрузки применяются к UI сразу,
   * но персистятся один раз — слиянием патча с загруженными настройками
   * (полный default-объект не должен затирать сохранённую тему/типографику). */
  const pendingLayoutPatchRef = useRef<Partial<AppearanceSettings['layout']>>({});

  // M1 invariant: the chat topic subscription must be registered exactly once
  // the bridge is READY — it used to ride on the (formerly default)
  // SessionsView mount; before ready the call would fail silently and no
  // stream events could ever reach the renderer (silent chat).
  useEffect(() => {
    if (!effectiveApi || snapshot.phase !== 'ready') return;
    void m1.subscribeEvents(effectiveApi).catch(() => undefined);
  }, [effectiveApi, snapshot.phase]);

  useEffect(() => {
    if (!effectiveApi) return undefined;
    let cancelled = false;
    void effectiveApi
      .getAppearance()
      .then((raw) => {
        if (cancelled) return;
        const loaded = migrateAppearance(raw);
        const patch = pendingLayoutPatchRef.current;
        const hasPatch = Object.keys(patch).length > 0;
        const merged = hasPatch
          ? { ...loaded, layout: { ...loaded.layout, ...patch } }
          : loaded;
        pendingLayoutPatchRef.current = {};
        setAppearance(merged);
        setAppearanceLoaded(true);
        if (hasPatch && effectiveApi) {
          // ровно одно сохранение — уже с загруженными настройками + патчем
          saveAppearanceRef.current = effectiveApi.saveAppearance(merged).catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setAppearanceLoaded(true); // fail-safe default, no crash
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveApi]);

  const themeTokens = appearance.theme.preset === 'custom' && appearance.theme.custom
    ? appearance.theme.custom
    : THEME_PRESETS[appearance.theme.preset === 'custom' ? 'dark' : appearance.theme.preset].tokens;

  useLayoutEffect(() => {
    applyTheme(document.documentElement, themeTokens);
    applyTypography(document.documentElement, appearance.typography);
  }, [themeTokens, appearance.typography]);

  const persistAppearance = (next: AppearanceSettings): void => {
    setAppearance(next);
    if (!effectiveApi) return;
    saveAppearanceRef.current = effectiveApi.saveAppearance(next).catch(() => undefined);
  };

  /* ------------------------------------------------------------------ *
   * Layout state: independent sidebars, persisted widths/collapse. §9.4.
   * D2: живой предпросмотр (drag) отделён от persistence — на каждое
   * mousemove IPC-записи не уходят, на mouseup/клавишу — ровно одна.
   * ------------------------------------------------------------------ */
  const [layoutPreview, setLayoutPreview] = useState<{
    leftWidth?: number;
    rightWidth?: number;
    terminalSlotHeight?: number;
  }>({});
  const leftWidth = layoutPreview.leftWidth ?? appearance.layout.leftWidth;
  const rightWidth = layoutPreview.rightWidth ?? appearance.layout.rightWidth;
  const terminalHeight = layoutPreview.terminalSlotHeight ?? appearance.layout.terminalSlotHeight;
  const terminalVisible = appearance.layout.terminalVisible;
  const detailsOpen = appearance.layout.rightVisible;
  const detailsRef = useRef<HTMLButtonElement | null>(null);

  const commitLayout = (patch: Partial<AppearanceSettings['layout']>): void => {
    setLayoutPreview({});
    const next = { ...appearance, layout: { ...appearance.layout, ...patch } };
    if (!appearanceReady) {
      // review P1-4: очередь до ready — UI отражает жест, персист после слияния
      pendingLayoutPatchRef.current = { ...pendingLayoutPatchRef.current, ...patch };
      setAppearance(next);
      return;
    }
    persistAppearance(next);
  };

  const openDetails = (): void => {
    commitLayout({ rightVisible: true });
  };
  const closeDetails = (): void => {
    commitLayout({ rightVisible: false });
    // §8: focus returns to the button that opened the panel (it stays mounted).
    detailsRef.current?.focus();
  };
  const toggleTerminal = (): void => {
    commitLayout({ terminalVisible: !terminalVisible });
  };

  /* ------------------------------------------------------------------ *
   * Active session + chat controller (§9.1 item 4): above all panels.
   * ------------------------------------------------------------------ */
  const [activeSession, setActiveSession] = useState<SessionInfoT | null>(null);
  const [pendingSession, setPendingSession] = useState<SessionInfoT | null>(null);
  // D3 derived: режим привязан к сессии, которая его выбрала.
  const sessionTab =
    sessionTabState.file === (activeSession?.file ?? null) ? sessionTabState.tab : 'history';
  const setSessionTab = (tab: 'history' | 'chat') =>
    setSessionTabState({ file: activeSession?.file ?? null, tab });
  const chat = useChat(effectiveApi, activeSession?.file ?? '');
  const [draft, setDraft] = useState('');
  const chatBusy = chat.state.status === 'open' || chat.state.status === 'sending' || chat.state.status === 'opening';

  const pickSession = (session: SessionInfoT): void => {
    if (activeSession?.file === session.file) {
      setView('chat');
      return;
    }
    // Explicit write boundary: never silently switch away from a live chat.
    if (chatBusy) {
      setPendingSession(session);
      setView('chat');
      return;
    }
    setActiveSession(session);
    setDraft('');
    setView('chat');
  };

  const confirmSwitchSession = async (): Promise<void> => {
    if (!pendingSession) return;
    const closed = await chat.closeChat();
    if (!closed) {
      // Fail-closed (review P1): the old session may still be live — keep the
      // confirm dialog up and do not present another session as active.
      return;
    }
    setActiveSession(pendingSession);
    setPendingSession(null);
    setDraft('');
    setView('chat');
  };

  const newChat = (): void => {
    // Bridge M1 has no create-session method (ALL_METHODS check): «Новый
    // диалог» focuses the most recent real session instead of faking creation.
    void (async () => {
      if (!effectiveApi) return;
      try {
        const { sessions } = await m1.listSessions(effectiveApi);
        if (sessions.length === 0) return;
        const mostRecent = [...sessions].sort((a, b) =>
          String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
        )[0];
        pickSession(mostRecent);
        setView('chat');
      } catch {
        // sidebar shows the load error; nothing else to do
      }
    })();
  };

  /**
   * R04 external discovery — default registrations only (tests that inject
   * `moduleDefinitions` bypass IPC entirely). The bridge owns the path
   * (params are `{}`), the response is schema-checked, every file-level or
   * bridge diagnostic becomes visible state, and persisted `enabled:false`
   * entries are applied AFTER registration so state can never resurrect an
   * invalid/incompatible module.
   */
  useEffect(() => {
    if (moduleDefinitions !== undefined || !effectiveApi) return undefined;
    if (readyKey === 'wait') return undefined;
    const api = effectiveApi;
    let cancelled = false;
    void (async () => {
      const problems: string[] = [];
      try {
        const response = await api.request('listModules');
        const parsed = ListModulesResultSchema.safeParse(response);
        if (!parsed.success) {
          problems.push('listModules: bridge вернул некорректный ответ (внешние модули пропущены)');
          if (!cancelled) {
            // N2: invalid payload counts as failure for registry isolation too.
            setModuleEntries(registerModules([DEMO_MODULE_MANIFEST]));
            confirmedRef.current = new Map<string, boolean>([[String(DEMO_MODULE_MANIFEST.id), true]]);
            // review #3 P2: an open module tab vanished with the registry —
            // never leave an orphaned view with no active nav destination.
            setView((current) => (current.startsWith('module:') ? 'modules' : current));
          }
        } else {
          const result = parsed.data;
          const raws: unknown[] = [DEMO_MODULE_MANIFEST];
          for (const entry of result.files) {
            if (entry.status === 'ok') {
              raws.push(entry.raw);
            } else {
              problems.push(`${entry.file}: ${entry.errors.join('; ')}`);
            }
          }
          problems.push(...result.diagnostics);
          let entries = registerModules(raws);
          for (const [id, enabled] of Object.entries(result.state)) {
            if (!enabled) entries = setModuleEnabled(entries, id, false);
          }
          if (!cancelled) {
            setModuleEntries(entries);
            // Baseline of server-confirmed states: failure reverts land here,
            // never on a blind inverse of the last click.
            const confirmed = new Map<string, boolean>();
            for (const entry of entries) {
              if (entry.state === 'enabled' || entry.state === 'disabled') {
                confirmed.set(entry.id, entry.state !== 'disabled');
              }
            }
            confirmedRef.current = confirmed;
          }
        }
      } catch (error) {
        problems.push(`listModules: ${error instanceof Error ? error.message : String(error)}`);
        if (!cancelled) {
          // Review N2: a failed discovery must never leave the PREVIOUS
          // environment's registry on screen — its toggles would persist into
          // the new environment. Fall back to the built-in demo only.
          setModuleEntries(registerModules([DEMO_MODULE_MANIFEST]));
          confirmedRef.current = new Map<string, boolean>([[String(DEMO_MODULE_MANIFEST.id), true]]);
          // review #3 P2: an open module tab vanished with the registry —
          // never leave an orphaned view with no active nav destination.
          setView((current) => (current.startsWith('module:') ? 'modules' : current));
        }
      }
      if (!cancelled) {
        setLoadDiagnostics(problems.slice(0, 64));
        setDiscoveredKey(readyKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveApi, moduleDefinitions, readyKey]);

  const toggleModule = (moduleId: string, enabled: boolean) => {
    const shouldPersist = moduleDefinitions === undefined && effectiveApi !== null;
    // Review #6: no toggle while discovery is still settling and no second
    // toggle for a module whose write is in flight — concurrent optimistic
    // reverts are what let the UI end up opposite to the persisted state.
    if (moduleDefinitions === undefined && (modulesLoading || persistingIds.has(moduleId))) {
      return;
    }
    if (shouldPersist) {
      setPersistingIds((prev) => new Set(prev).add(moduleId));
      setPersistError(null);
    }
    setModuleEntries((entries) => setModuleEnabled(entries, moduleId, enabled));
    // Leaving a module tab when its module gets disabled keeps the app sane.
    if (!enabled) {
      setView((current) =>
        current.startsWith(`module:${moduleId}/`) ? 'chat' : current,
      );
    }
    // R04 persistence (default path only): optimistic update, then persist.
    // A rejected write reverts to the LAST SERVER-CONFIRMED state (not a blind
    // inverse of the click) — the visible state never silently diverges from
    // what is stored, and the failure is always on screen.
    if (shouldPersist && effectiveApi) {
      const api = effectiveApi;
      void api
        .request('setModuleState', { id: moduleId, enabled })
        .then(() => {
          confirmedRef.current.set(moduleId, enabled);
          setPersistingIds((prev) => {
            const next = new Set(prev);
            next.delete(moduleId);
            return next;
          });
          setPersistError(null);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const confirmed = confirmedRef.current.get(moduleId) ?? true;
          setModuleEntries((entries) => setModuleEnabled(entries, moduleId, confirmed));
          setPersistingIds((prev) => {
            const next = new Set(prev);
            next.delete(moduleId);
            return next;
          });
          setPersistError(`Не удалось сохранить состояние «${moduleId}»: ${message}`);
        });
    }
  };

  const tabs = moduleTabs(moduleEntries);
  const panels = modulePanels(moduleEntries);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeModuleTab =
    view.startsWith('module:') ? tabs.find((t) => t.tabKey === view.slice('module:'.length)) : undefined;

  /**
   * Declarative action dispatcher. The manifest schema only admits operations
   * from MODULE_OPERATIONS, and every failure below becomes visible state
   * instead of a thrown error that would take the surface down.
   * An EXPLICIT target that cannot be resolved fails closed — it must never
   * silently degrade into "success".
   */
  const runModuleAction = (moduleId: string, action: ModuleAction) => {
    switch (action.operation) {
      case 'openTab': {
        if (action.target) {
          const resolved =
            tabs.find((t) => t.tabKey === action.target) ??
            tabs.find((t) => t.entry.id === action.target);
          if (!resolved) {
            setActionError(`Действие «${action.id}»: вкладка «${action.target}» не найдена`);
            return;
          }
          setActionError(null);
          setView(`module:${resolved.tabKey}`);
          return;
        }
        const own = tabs.find((t) => t.entry.id === moduleId);
        if (!own) {
          setActionError(`Действие «${action.id}»: у модуля «${moduleId}» нет вкладки`);
          return;
        }
        setActionError(null);
        setView(`module:${own.tabKey}`);
        return;
      }
      case 'openPanel':
        setActionError(null);
        setView('modules');
        return;
      case 'refresh':
        setActionError(null);
        void refreshRuntime();
        return;
      case 'copyText': {
        const write = navigator.clipboard?.writeText(action.target ?? action.title);
        if (write) {
          void write
            .then(() => setActionError(null))
            .catch(() => setActionError(`Действие «${action.id}»: буфер обмена недоступен`));
        } else {
          setActionError(`Действие «${action.id}»: буфер обмена недоступен`);
        }
        return;
      }
      default:
        setActionError(`Действие «${action.id}»: операция не поддерживается`);
    }
  };

  /* ------------------------------------------------------------------ *
   * Center column content
   * ------------------------------------------------------------------ */
  /** Toggle панели деталей: §8 — одна кнопка в chat-crumbs (пустое состояние
   * и активная сессия — взаимоисключающие строки, обе с detailsRef). */
  /** D3: тумблер правой панели в утверждённом обличье Design Lab
   * (иконка/классы лаба-cumb actions; поведение и testid прежние). */
  const detailsToggleBtn = (
    <button
      type="button"
      ref={detailsRef}
      data-testid="open-details"
      className={
        detailsOpen ? 'dl-btn-accent dl-toolbar-expand' : 'dl-btn-ghost dl-toolbar-dots'
      }
      aria-pressed={detailsOpen}
      aria-label="Показать панель деталей"
      title="Показать панель деталей"
      onClick={() => (detailsOpen ? closeDetails() : openDetails())}
    >
      <IconPanelExpand size={22} />
    </button>
  );

  /** D3: единственная crumb-row главного экрана (структура Design Lab):
   * crumb-данные слева, actions (режим сессии + тумблер панели) справа. */
  const sessionCrumb = activeSession ? (
    <>
      <span
        className="muted"
        title={activeSession.projectPath}
      >
        {activeSession.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Проект'}
      </span>
      <span aria-hidden="true">/</span>
      <strong title={activeSession.file}>
        {activeSession.name ?? activeSession.id.slice(0, 8)}
      </strong>
      {activeSession.activeWrite && <span className="badge badge-active">запись</span>}
      {activeSession.availability !== 'ok' && (
        <span className="badge badge-warn">⚠ {activeSession.diagnostics ?? activeSession.availability}</span>
      )}
    </>
  ) : null;

  const sessionTabs =
    view === 'chat' && activeSession ? (
      // C1/L1: общий ui/SessionTabs — тот же узел рендерит Design Lab
      <SessionTabs mode={sessionTab} onChange={setSessionTab} />
    ) : null;

  const headerRow =
    view === 'chat'
      ? {
          crumb: sessionCrumb ?? <strong>Диалог</strong>,
          actions: (
            <>
              {sessionTabs}
              {detailsToggleBtn}
            </>
          ),
        }
      : {
          crumb: (
            <strong>
              {view === 'resources'
                ? 'Ресурсы'
                : view === 'modules' || view.startsWith('module:')
                  ? 'Модули'
                  : 'Настройки'}
            </strong>
          ),
          actions: undefined as React.ReactNode,
        };

  let centerBody: React.ReactNode;
  if (view === 'chat') {
    // D3 (owner #6398531407): тот же утверждённый чат-контур Design Lab;
    // legacy-диагностика (StatusPanel) заменена компактной информацией
    // о подключении внутри пустого состояния чата.
    centerBody = (
      <div className="chat-workspace" data-testid="view-chat">
        {pendingSession && (
          <div className="switch-guard" role="alert" data-testid="switch-guard">
            <span>
              Чат открыт — переключение на другой диалог прервёт его.
            </span>
            <div className="switch-guard-actions">
              <button
                type="button"
                data-testid="switch-confirm"
                onClick={() => void confirmSwitchSession()}
              >
                Закрыть чат и переключиться
              </button>
              <button type="button" data-testid="switch-cancel" onClick={() => setPendingSession(null)}>
                Остаться
              </button>
            </div>
          </div>
        )}
        {activeSession ? (
          <section className="dl-session-detail" data-testid="session-detail">
            <div className="dl-session-body">
              {sessionTab === 'history' ? (
                <HistoryView api={effectiveApi as DesktopApi} file={activeSession.file} />
              ) : (
                <ChatPane chat={chat} draft={draft} onDraftChange={setDraft} />
              )}
            </div>
          </section>
        ) : (
          <ChatView
            turns={[]}
            composer={null}
            notice={
              <div data-testid="chat-empty">
                <h2 className="dl-h2">Выберите диалог слева</h2>
                <p className="muted">
                  Проекты и чаты загружаются из Pi в WSL. Открытие диалога запускает самую свежую
                  сессию; создание файлов сессий доступно в Pi CLI.
                </p>
                <button type="button" className="dl-btn-primary" onClick={newChat}>
                  Открыть последний диалог
                </button>
                {/* D3: честная компактная статус-цепь §5 ВНУТРИ утверждённой
                    пустой композиции чата (без legacy StatusPanel-обёртки
                    region/runtime-testid). */}
                <div className="empty-status">
                  {snapshot.phase !== 'error' && snapshot.phase !== 'ready' ? (
                    <span data-testid="spinner" className="spinner" aria-hidden="true" />
                  ) : null}
                  <span data-testid="status-phase">{phaseText(snapshot)}</span>
                  {snapshot.phase === 'error' && snapshot.lastError ? (
                    <div className="error-box" role="alert">
                      <div>
                        <strong data-testid="error-code">{snapshot.lastError.code}</strong>
                        <span> — {snapshot.lastError.message}</span>
                      </div>
                      <button
                        type="button"
                        className="dl-btn-ghost"
                        onClick={() => void retry()}
                      >
                        Повторить подключение
                      </button>
                    </div>
                  ) : null}
                  {snapshot.distros && snapshot.distros.length > 0 ? (
                    <label className="distro-row">
                      <span>Дистрибутив</span>
                      <select
                        data-testid="distro"
                        value={snapshot.distro ?? snapshot.distros[0] ?? ''}
                        onChange={(e) => void selectDistro(e.target.value)}
                      >
                        {snapshot.distros.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {snapshot.phase === 'ready' && snapshot.runtime ? (
                    <span className="muted">
                      Pi <span>{snapshot.runtime.pi.version}</span> · Node{' '}
                      <span>{snapshot.runtime.node.version}</span>
                    </span>
                  ) : null}
                  {snapshot.phase === 'ready' ? (
                    <button
                      type="button"
                      className="dl-btn-ghost"
                      onClick={() => void refreshRuntime()}
                    >
                      Обновить данные
                    </button>
                  ) : null}
                  {requestError ? (
                    <span className="request-error" role="alert" data-testid="request-error">
                      {' '}
                      {requestError}
                    </span>
                  ) : null}
                  {!effectiveApi && snapshot.phase !== 'error' ? (
                    <span className="request-error" role="status" data-testid="request-error">
                      Preload API unavailable
                    </span>
                  ) : null}
                </div>
              </div>
            }
          />
        )}
        {terminalVisible ? (
          <TerminalDock
            height={terminalHeight}
            onHeightPreview={(h) => setLayoutPreview((p) => ({ ...p, terminalSlotHeight: h }))}
            onHeightCommit={(h) => commitLayout({ terminalSlotHeight: h })}
          />
        ) : null}
      </div>
    );
  } else if (view === 'resources') {
    centerBody = <div data-testid="view-resources"><ResourcesView api={effectiveApi} /></div>;
  } else if (view === 'settings') {
    centerBody = (
      <div data-testid="view-settings">
        {appearanceReady ? (
        <SettingsView
          api={effectiveApi}
          appearance={appearance}
          ready={appearanceReady}
          onChange={persistAppearance}
          onReset={() => {
            if (!effectiveApi) {
              setAppearance(DEFAULT_APPEARANCE);
              return;
            }
            void effectiveApi.resetAppearance().then((raw) => setAppearance(migrateAppearance(raw)));
          }}
          snapshot={snapshot}
          requestError={requestError}
          onRetry={() => void retry()}
          onRefresh={() => void refreshRuntime()}
          onSelectDistro={(d) => void selectDistro(d)}
          layout={{
            leftWidth,
            rightWidth,
            leftCollapsed: appearance.layout.leftCollapsed,
            onLeftWidth: (w) => {
              const width = Math.min(LEFT_MAX, Math.max(LEFT_MIN, w));
              persistAppearance({ ...appearance, layout: { ...appearance.layout, leftWidth: width } });
            },
            onRightWidth: (w) => {
              const width = Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, w));
              persistAppearance({ ...appearance, layout: { ...appearance.layout, rightWidth: width } });
            },
            onToggleLeft: () => {
              const next = !appearance.layout.leftCollapsed;
              persistAppearance({ ...appearance, layout: { ...appearance.layout, leftCollapsed: next } });
            },
            onTerminalHeight: (h) => {
              const height = Math.min(600, Math.max(120, h));
              persistAppearance({ ...appearance, layout: { ...appearance.layout, terminalSlotHeight: height } });
            },
          }}
        />
        ) : (
          <div className="loading-row" data-testid="settings-loading">
            Загрузка настроек…
          </div>
        )}
      </div>
    );
  } else if (activeModuleTab) {
    centerBody = (
      <ModuleTabView
        key={activeModuleTab.tabKey}
        tab={activeModuleTab}
        onDisable={(id) => toggleModule(id, false)}
        onAction={(action) => runModuleAction(activeModuleTab.entry.id, action)}
      />
    );
  } else if (view === 'modules') {
    centerBody = (
      <div data-testid="view-modules">
        <ModulesView
          entries={moduleEntries}
          diagnostics={loadDiagnostics}
          loading={modulesLoading}
          busyIds={persistingIds}
          onToggle={(id, enabled) => toggleModule(id, enabled)}
        />
      </div>
    );
  } else {
    // Unreachable view union member — fall back to chat rather than blank.
    centerBody = <div data-testid="view-chat" />;
  }

  const modulePanelsSection =
    panels.length > 0 ? (
      <section className="module-panels" aria-label="Панели модулей">
        {panels.map((panel, index) => {
          const manifest = panel.entry.manifest;
          const ownsNoTab = !!manifest && !manifest.ui.some((ui) => ui.kind === 'tab');
          const firstSurfaceOfModule =
            panels.findIndex((other) => other.entry.key === panel.entry.key) === index;
          return (
            <ModulePanel
              key={panel.tabKey}
              panel={panel}
              actions={ownsNoTab && firstSurfaceOfModule ? (manifest?.actions ?? []) : undefined}
              onAction={(action) => runModuleAction(panel.entry.id, action)}
              onDisable={() => toggleModule(panel.entry.id, false)}
            />
          );
        })}
      </section>
    ) : null;

  const moduleErrors = (
    <>
      {persistError && (
        <p className="request-error" role="alert" data-testid="modules-persist-error">
          {persistError}
        </p>
      )}
      {actionError && (
        <p className="request-error" role="alert" data-testid="module-action-error">
          {actionError}
        </p>
      )}
    </>
  );

  return (
    <main
      data-testid="app-root"
      className="app-root"
      style={
        {
          // Единый источник правды — persisted appearance (+ живой preview):
          // AppScreen/AppFrame читают CSS-переменные для grid-колонок; на узких
          // экранах media-query переопределяет переменную локально (rail/overlay).
          '--dl-app-side-w': appearance.layout.leftCollapsed ? 'var(--dl-rail-w)' : `${leftWidth}px`,
          '--dl-app-details-w': `${rightWidth}px`,
        } as React.CSSProperties
      }
    >
      {/* D3: ОДНА композиция с Design Lab (src/renderer/ui/AppScreen) —
          разница только в данных и callback-биндингах. */}
      <AppScreen
        testid="app-shell"
        theme={appearance.theme.preset === 'light' ? 'light' : 'dark'}
        windowControls={{
          onMinimize: () => {
            void effectiveApi?.windowControls?.minimize();
          },
          onMaximize: () => {
            void effectiveApi?.windowControls?.maximize();
          },
          onClose: () => {
            void effectiveApi?.windowControls?.close();
          },
        }}
        side={
          <LeftSidebar
            api={effectiveApi}
            collapsed={appearance.layout.leftCollapsed}
            width={leftWidth}
            view={view}
            activeFile={activeSession?.file ?? null}
            onToggleCollapsed={() => commitLayout({ leftCollapsed: !appearance.layout.leftCollapsed })}
            onNewChat={newChat}
            connectionReady={snapshot.phase === 'ready'}
            moduleTabs={tabs.map(({ tabKey, tab }) => ({ tabKey, title: tab.title }))}
            onView={(v) => setView(v as View)}
            onPickSession={pickSession}
            onWidthPreview={(w) => setLayoutPreview((p) => ({ ...p, leftWidth: w }))}
            onWidthCommit={(w) => commitLayout({ leftWidth: w })}
          />
        }
        details={
          detailsOpen && view === 'chat'
            ? {
                header: <RightSidebarHead onClose={closeDetails} />,
                body: (
                  <RightSidebar
                    tools={chat.state.tools}
                    streaming={chat.state.status === 'sending'}
                    title={activeSession ? (activeSession.name ?? activeSession.id.slice(0, 8)) : undefined}
                  />
                ),
                handle: (
                  <RightSidebarResize
                    width={rightWidth}
                    onWidthPreview={(w) => setLayoutPreview((p) => ({ ...p, rightWidth: w }))}
                    onWidthCommit={(w) => commitLayout({ rightWidth: w })}
                  />
                ),
              }
            : null
        }
        header={headerRow}
        panels={modulePanelsSection}
        body={centerBody}
        errors={moduleErrors}
        statusBar={{
          connection: {
            label:
              snapshot.phase === 'ready'
                ? 'Pi подключён'
                : snapshot.phase === 'error'
                  ? 'Ошибка подключения'
                  : 'Подключение…',
            dot: snapshot.phase === 'ready',
            testid: 'status-connection',
          },
          distro: `${snapshot.distro ?? '—'} · WSL`,
          distroTestId: 'status-distro',
          right: [
            { id: 'status-os', text: 'Windows', mute: true },
            { id: 'status-cpu', text: 'CPU —', mute: true },
            { id: 'status-ram', text: 'RAM —', mute: true },
          ],
          terminalLabel: 'Терминал',
          terminalTestId: 'status-terminal-btn',
          terminalActive: terminalVisible,
          onTerminalToggle: toggleTerminal,
        }}
      />
    </main>
  );
}
