import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './index.css';
import { getDesktopApi, type DesktopApi } from './api';
import { SessionDetail } from './SessionDetail';
import { ResourcesView, type ResTab } from './ResourcesView';
import { ModulesView } from './ModulesView';
import { SettingsView, type Section } from './SettingsView';
import { ModulePanel } from './ModulePanel';
import { ModuleTabView } from './ModuleTabView';
import type { ModuleAction } from '../shared/m3Protocol';
import { ListModulesResultSchema } from '../shared/m3Ipc';
import { useConnection } from './useConnection';
import { useChat } from './useChat';
import { useHistoryFeed } from './historyFeed';
import { DEMO_MODULE_MANIFEST } from './modules/demoModule';
import {
  modulePanels,
  moduleTabs,
  registerModules,
  setModuleEnabled,
  type ModuleEntry,
} from './modules/registry';
import { AppShell } from './shell/AppShell';
import { LeftSidebar } from './shell/LeftSidebar';
import { RightSidebar } from './shell/RightSidebar';
import { StatusBar } from './shell/StatusBar';
import { IconDetailsPanel } from './shell/icons';
import { applyTheme } from './design/applyTheme';
import { applyTypography } from './design/applyTypography';
import { THEME_PRESETS } from '../shared/design/presets';
import { DEFAULT_APPEARANCE, migrateAppearance, type AppearanceSettings } from '../shared/appearance';
import { m1, parseBridgeError } from './m1api';
import { sessionLabel } from './shell/LeftSidebar';
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

/** R03 п.3: window-titlebar path labels (ref3/ref4 — «Секция / Подсекция»). */
const RES_TAB_LABELS: Record<ResTab, string> = { skills: 'Skills', packages: 'Extensions', mcp: 'MCP' };
const SETTINGS_SECTION_LABELS: Record<Section, string> = {
  appearance: 'Внешний вид',
  typography: 'Типографика',
  workspace: 'Рабочее пространство',
  connection: 'Подключение',
};

export function App({ api, moduleDefinitions }: AppProps = {}) {
  const effectiveApi = api === undefined ? getDesktopApi() : api;
  const { snapshot, requestError, connectionSeq, retry, selectDistro, refreshRuntime } = useConnection(effectiveApi);
  /** §9.6 step 2: chat is the default workspace (details of the base screen). */
  const [view, setView] = useState<View>('chat');
  /** Which Settings section to land on when Settings opens (R02 review P2:
   * the connection-recovery shortcut must reach Connection, not Appearance). */
  const [settingsSection, setSettingsSection] = useState<Section>('appearance');
  /** R03 п.3: live resources tab for the window-titlebar path. */
  const [resourcesTab, setResourcesTab] = useState<ResTab>('skills');
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
        const next = migrateAppearance(raw);
        setAppearance(next);
        setAppearanceLoaded(true);
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

  /** A1: native caption buttons follow the active theme (optional API —
   *  no-op in tests and with older preloads). */
  useEffect(() => {
    const overlay = effectiveApi?.setTitleBarOverlay;
    if (!overlay) return;
    void overlay
      .call(effectiveApi, {
        backgroundColor: themeTokens.titleBarBackgroundColor,
        textColor: themeTokens.bodyTextColor,
      })
      .catch(() => undefined);
  }, [effectiveApi, themeTokens]);

  const persistAppearance = (next: AppearanceSettings): void => {
    setAppearance(next);
    if (!effectiveApi) return;
    saveAppearanceRef.current = effectiveApi.saveAppearance(next).catch(() => undefined);
  };

  /* ------------------------------------------------------------------ *
   * Layout state: independent sidebars, persisted widths/collapse. §9.4.
   * ------------------------------------------------------------------ */
  // Layout is a single source of truth (persisted appearance) — panels read and
  // write it directly, so no effect-driven state sync can ever drift.
  const rightWidth = appearance.layout.rightWidth;
  const leftWidth = appearance.layout.leftWidth;
  const detailsOpen = appearance.layout.rightVisible;
  const detailsRef = useRef<HTMLButtonElement | null>(null);

  const openDetails = (): void => {
    persistAppearance({
      ...appearance,
      layout: { ...appearance.layout, rightVisible: true },
    });
  };
  const closeDetails = (): void => {
    persistAppearance({
      ...appearance,
      layout: { ...appearance.layout, rightVisible: false },
    });
    // §8: focus returns to the button that opened the panel (it stays mounted).
    detailsRef.current?.focus();
  };

  /* ------------------------------------------------------------------ *
   * Active session + chat controller (§9.1 item 4): above all panels.
   * ------------------------------------------------------------------ */
  const [activeSession, setActiveSession] = useState<SessionInfoT | null>(null);
  const [pendingSession, setPendingSession] = useState<SessionInfoT | null>(null);
  /** R03 п.2: create-while-busy needs the same fail-closed confirm as switch. */
  const [pendingNewDialog, setPendingNewDialog] = useState(false);
  /** Files created via newSession that have not materialized on disk yet. */
  const [provisional, setProvisional] = useState<ReadonlySet<string>>(() => new Set());
  const [newChatError, setNewChatError] = useState<{ code: string; message: string } | null>(null);
  // Review P1-3 (renderer): a SYNCHRONOUS create reservation — rapid repeat
  // activations cannot start a second newSession while the first is in flight.
  const creatingDialogRef = useRef(false);
  const [creatingDialog, setCreatingDialog] = useState(false);
  /** Bumped when a provisional session materializes — the sidebar refetches. */
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const chat = useChat(effectiveApi, activeSession?.file ?? '');
  // Review P1-2: the conversation feed is app-lifetime — it must survive
  // leaving/returning the chat view so a re-entry cannot refetch persisted
  // history on top of the controller's retained live entries.
  const historyFeed = useHistoryFeed(effectiveApi, activeSession?.file ?? '');
  const [draft, setDraft] = useState('');
  const chatBusy = chat.state.status === 'open' || chat.state.status === 'sending' || chat.state.status === 'opening';

  /** Review P1-4: retiring ABANDONED provisional records on the transition
   * itself (never in an effect) — a dialog left un-materialized when the
   * user switches away must not drive reconciliation churn. */
  const retireOtherProvisional = (file: string): void =>
    setProvisional((prev) => {
      if (prev.size === 0 || prev.has(file)) return prev;
      const next = new Set(prev);
      for (const f of prev) next.delete(f);
      return next;
    });

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
    retireOtherProvisional(session.file);
    setActiveSession(session);
    setDraft('');
    setNewChatError(null);
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
    retireOtherProvisional(pendingSession.file);
    setActiveSession(pendingSession);
    setPendingSession(null);
    setDraft('');
    setView('chat');
  };

  /** R03 п.2 — REAL session creation over the bridge (single-slot, fail-closed). */
  const createDialog = async (): Promise<void> => {
    if (!effectiveApi) return;
    if (creatingDialogRef.current) return; // review P1-3: one create at a time
    creatingDialogRef.current = true;
    setCreatingDialog(true);
    setNewChatError(null);
    try {
      const r = await m1.newSession(
        effectiveApi,
        activeSession?.projectPath ? { projectPath: activeSession.projectPath } : {},
      );
      // The new dialog replaces any abandoned provisional sibling (review P1-4).
      retireOtherProvisional(r.session.file);
      setProvisional((prev) => new Set(prev).add(r.session.file));
      setActiveSession(r.session);
      chat.adoptOpen(r.state, r.session.file);
      setDraft('');
      setView('chat');
    } catch (err) {
      setNewChatError(parseBridgeError(err));
    } finally {
      creatingDialogRef.current = false;
      setCreatingDialog(false);
    }
  };

  const confirmPendingNewDialog = async (): Promise<void> => {
    const closed = await chat.closeChat();
    if (!closed) {
      // Fail-closed: the old session may still be live — keep the guard up.
      return;
    }
    setPendingNewDialog(false);
    await createDialog();
  };

  const newChat = (): void => {
    if (!effectiveApi) return;
    // Never auto-close a live chat: ask first, exactly like session switching.
    if (chatBusy) {
      setPendingNewDialog(true);
      setView('chat');
      return;
    }
    void createDialog();
  };

  /** Honest secondary action (never relabelled as creation): opens the most
   * recent EXISTING session — kept for the empty state only. */
  const openLatestDialog = (): void => {
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

  /* R03 п.2 lifecycle: a created session exists in the Pi process only until
   * its first message materializes the JSONL file (Pi _hasConversation). The
   * index is the single source of truth — once the file appears the real
   * record replaces the provisional one and the sidebar refreshes; if the
   * chat is closed first, the never-persisted dialog is honestly dropped. */
  useEffect(() => {
    // Review P1-4: only an ACTIVE provisional file is reconciled — records
    // for other sessions are outside this effect's ownership (retired above).
    if (!effectiveApi || provisional.size === 0 || !activeSession) return undefined;
    if (!provisional.has(activeSession.file)) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { sessions } = await m1.listSessions(effectiveApi);
        if (cancelled) return;
        const file = activeSession.file;
        const real = sessions.find((s) => s.file === file);
        const drop = (): void =>
          setProvisional((prev) => {
            const next = new Set(prev);
            next.delete(file);
            return next;
          });
        if (real) {
          drop();
          // Identity-stable replace: unchanged data keeps the same object →
          // effect deps settle instead of spawning another refetch (review P1-4).
          setActiveSession((prev) =>
            prev && prev.file === real.file && prev.updatedAt === real.updatedAt && prev.availability === real.availability && prev.name === real.name
              ? prev
              : real,
          );
          setSidebarRefreshKey((k) => k + 1);
        } else if (chat.state.status === 'closed') {
          drop();
          // Identity-stable null transition as well.
          setActiveSession((prev) => (prev && prev.file === file ? null : prev));
          setSidebarRefreshKey((k) => k + 1);
        }
      } catch {
        // discovery errors are surfaced by the sidebar; the next transition retries
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveApi, activeSession, provisional, chat.state.status]);

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
  const centerHeader =
    view === 'chat' ? (
      <header className="center-head" data-testid="chat-head">
        <div className="center-title">
          <span className="muted">
            {activeSession ? activeSession.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Проект' : 'Pi Desktop'}
          </span>
          <span className="center-slash" aria-hidden="true">/</span>
          <strong title={activeSession ? sessionLabel(activeSession) : undefined}>
            {activeSession ? sessionLabel(activeSession) : 'Диалог'}
          </strong>
          {activeSession?.activeWrite && <span className="badge badge-active">запись</span>}
          {activeSession &&
            activeSession.availability !== 'ok' &&
            activeSession.availability !== 'empty' && (
              <span className="badge badge-warn">⚠ {activeSession.diagnostics ?? activeSession.availability}</span>
            )}
        </div>
        <div className="center-actions">
          <button
            type="button"
            ref={detailsRef}
            data-testid="open-details"
            className={`icon-btn${detailsOpen ? ' icon-btn-active' : ''}`}
            title="Показать детали"
            aria-label="Показать панель деталей"
            aria-pressed={detailsOpen}
            onClick={openDetails}
          >
            <IconDetailsPanel />
          </button>
        </div>
      </header>
    ) : (
      <header className="center-head" data-testid="view-head">
        <div className="center-title">
          {/* R03 п.3: the titlebar carries the PATH («Секция / Подсекция»,
              ref3/ref4) — never a bare repeat of the content heading. */}
          {view === 'resources' && (
            <>
              <strong>Ресурсы</strong>
              <span className="center-slash">{" / "}</span>
              <span className="muted">{RES_TAB_LABELS[resourcesTab]}</span>
            </>
          )}
          {view === 'settings' && (
            <>
              <strong>Настройки</strong>
              <span className="center-slash">{" / "}</span>
              <span className="muted">{SETTINGS_SECTION_LABELS[settingsSection]}</span>
            </>
          )}
          {(view === 'modules' || view.startsWith('module:')) && (
            <>
              <strong>Модули</strong>
              {view.startsWith('module:') && (() => {
                const tab = tabs.find((t) => t.tabKey === view.slice('module:'.length));
                return tab ? (
                  <>
                    <span className="center-slash">{" / "}</span>
                    <span className="muted">{tab.tab.title}</span>
                  </>
                ) : null;
              })()}
            </>
          )}
        </div>
      </header>
    );

  let centerBody: React.ReactNode;
  if (view === 'chat') {
    centerBody = (
      <div className="chat-workspace" data-testid="view-chat">
        {newChatError && (
          <div className="error-box" role="alert" data-testid="new-chat-error">
            <strong>{newChatError.code}</strong> — {newChatError.message}
            <div>
              <button
                type="button"
                onClick={() => {
                  setNewChatError(null);
                  newChat();
                }}
              >
                Повторить
              </button>
            </div>
          </div>
        )}
        {(pendingSession || pendingNewDialog) && (
          <div className="switch-guard" role="alert" data-testid="switch-guard">
            <span>
              {pendingNewDialog
                ? 'Чат открыт — новый диалог закроет текущую сессию.'
                : 'Чат открыт — переключение на другой диалог прервёт его.'}
            </span>
            <div className="switch-guard-actions">
              <button
                type="button"
                data-testid="switch-confirm"
                onClick={() => {
                  if (pendingNewDialog) void confirmPendingNewDialog();
                  else void confirmSwitchSession();
                }}
              >
                {pendingNewDialog ? 'Закрыть чат и создать новый' : 'Закрыть чат и переключиться'}
              </button>
              <button
                type="button"
                data-testid="switch-cancel"
                onClick={() => {
                  setPendingSession(null);
                  setPendingNewDialog(false);
                }}
              >
                Остаться
              </button>
            </div>
          </div>
        )}
        {activeSession ? (
          <div className="session-detail-wrap">
            <SessionDetail
              feed={historyFeed}
              chat={chat}
              draft={draft}
              onDraftChange={setDraft}
            />
          </div>
        ) : (
          <div className="empty-state" data-testid="chat-empty">
            <span className="empty-state-mark" aria-hidden="true">
              π
            </span>
            <h2>Выберите диалог слева</h2>
            <p className="muted">
              Проекты и чаты загружаются из Pi в WSL. Создайте новый диалог или выберите
              существующий.
            </p>
            <button
              type="button"
              className="btn-primary"
              data-testid="empty-new-chat"
              title="Создать новый диалог через Pi RPC"
              onClick={newChat}
              disabled={creatingDialog}
            >
              Новый диалог
            </button>
            <button
              type="button"
              data-testid="empty-open-latest"
              title="Открыть самый свежий существующий диалог"
              onClick={openLatestDialog}
            >
              Открыть последний диалог
            </button>
            {snapshot.phase === 'error' && (
              <div className="empty-connection-error" role="alert" data-testid="empty-connection-error">
                <strong>{snapshot.lastError?.code ?? 'CONNECTION_ERROR'}</strong>{' '}
                — {snapshot.lastError?.message ?? 'Не удалось подключиться к Pi в WSL'}
                <div>
                  <button
                    type="button"
                    data-testid="empty-open-settings"
                    onClick={() => {
                      setSettingsSection('connection');
                      setView('settings');
                    }}
                  >
                    Открыть настройки подключения
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  } else if (view === 'resources') {
    centerBody = <div className="view-pane" data-testid="view-resources"><ResourcesView api={effectiveApi} tab={resourcesTab} onTabChange={setResourcesTab} /></div>;
  } else if (view === 'settings') {
    centerBody = (
      <div className="view-pane" data-testid="view-settings">
        <SettingsView
          api={effectiveApi}
          appearance={appearance}
          ready={appearanceReady}
          initialSection={settingsSection}
          onSectionChange={setSettingsSection}
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
      <div className="view-pane" data-testid="view-modules">
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

  return (
    <main data-testid="app-root" className="app-root">
    <AppShell
      left={
        <LeftSidebar
          api={effectiveApi}
          collapsed={appearance.layout.leftCollapsed}
          width={leftWidth}
          view={view}
          activeFile={activeSession?.file ?? null}
          distro={snapshot.distro}
          onToggleCollapsed={() => {
            const next = !appearance.layout.leftCollapsed;
            persistAppearance({ ...appearance, layout: { ...appearance.layout, leftCollapsed: next } });
          }}
          onNewChat={newChat}
          newChatPending={creatingDialog}
          refreshKey={sidebarRefreshKey}
          connectionReady={snapshot.phase === 'ready'}
          moduleTabs={tabs.map(({ tabKey, tab }) => ({ tabKey, title: tab.title }))}
          onView={(v) => {
            if (v === 'settings') setSettingsSection('appearance');
            setView(v as View);
          }}
          onPickSession={pickSession}
          onPickProject={() => undefined}
        />
      }
      center={
        <>
          {centerHeader}
          {panels.length > 0 && (
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
                    actions={
                      ownsNoTab && firstSurfaceOfModule ? (manifest?.actions ?? []) : undefined
                    }
                    onAction={(action) => runModuleAction(panel.entry.id, action)}
                    onDisable={() => toggleModule(panel.entry.id, false)}
                  />
                );
              })}
            </section>
          )}
          <div className="center-body">{centerBody}</div>
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
      }
      right={
        detailsOpen && view === 'chat' ? (
          <RightSidebar
            width={rightWidth}
            tools={chat.state.tools}
            streaming={chat.state.status === 'sending'}
            title={activeSession ? sessionLabel(activeSession) : null}
            onClose={closeDetails}
          />
        ) : null
      }
      status={
        <StatusBar
          phase={snapshot.phase}
          distro={snapshot.distro}
          onOpenSettings={() => setView('settings')}
        />
      }
    />
    </main>
  );
}
