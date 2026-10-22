import { useEffect, useRef, useState } from 'react';
import './index.css';
import { getDesktopApi, type DesktopApi } from './api';
import { StatusPanel } from './StatusPanel';
import { SessionsView } from './SessionsView';
import { ResourcesView } from './ResourcesView';
import { ModulesView } from './ModulesView';
import { ModulePanel } from './ModulePanel';
import { ModuleTabView } from './ModuleTabView';
import type { ModuleAction } from '../shared/m3Protocol';
import { ListModulesResultSchema } from '../shared/m3Ipc';
import { useConnection } from './useConnection';
import { DEMO_MODULE_MANIFEST } from './modules/demoModule';
import {
  modulePanels,
  moduleTabs,
  registerModules,
  setModuleEnabled,
  type ModuleEntry,
} from './modules/registry';

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

type View = 'status' | 'sessions' | 'resources' | 'modules' | `module:${string}`;

export function App({ api, moduleDefinitions }: AppProps = {}) {
  const effectiveApi = api === undefined ? getDesktopApi() : api;
  const { snapshot, requestError, retry, selectDistro, refreshRuntime } = useConnection(effectiveApi);
  const [view, setView] = useState<View>('status');
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
  const readyKey = !effectiveApi
    ? 'no-api'
    : snapshot.phase === 'ready' && snapshot.distro !== null
      ? `ready:${snapshot.distro}:${snapshot.attempt}`
      : snapshot.phase === 'error'
        ? `error:${snapshot.attempt}`
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
        current.startsWith(`module:${moduleId}/`) ? 'status' : current,
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

  return (
    <main data-testid="app-root" className="app">
      <h1>Pi WSL Desktop</h1>
      <p className="subtitle">Foundation &amp; Sessions &amp; Resources &amp; Modules · M0 + M1 + M2 + M3</p>
      <nav className="main-tabs" data-testid="main-tabs">
        <button
          type="button"
          data-testid="tab-status"
          className={view === 'status' ? 'tab tab-active' : 'tab'}
          aria-pressed={view === 'status'}
          onClick={() => setView('status')}
        >
          Статус
        </button>
        <button
          type="button"
          data-testid="tab-sessions"
          className={view === 'sessions' ? 'tab tab-active' : 'tab'}
          aria-pressed={view === 'sessions'}
          onClick={() => setView('sessions')}
        >
          Сессии
        </button>
        <button
          type="button"
          data-testid="tab-resources"
          className={view === 'resources' ? 'tab tab-active' : 'tab'}
          aria-pressed={view === 'resources'}
          onClick={() => setView('resources')}
        >
          Ресурсы
        </button>
        <button
          type="button"
          data-testid="tab-modules"
          className={view === 'modules' ? 'tab tab-active' : 'tab'}
          aria-pressed={view === 'modules'}
          onClick={() => setView('modules')}
        >
          Модули
        </button>
        {tabs.map(({ tabKey, tab }) => (
          <button
            key={tabKey}
            type="button"
            data-testid={`tab-module-${tabKey}`}
            className={view === `module:${tabKey}` ? 'tab tab-active' : 'tab'}
            aria-pressed={view === `module:${tabKey}`}
            onClick={() => setView(`module:${tabKey}`)}
          >
            {tab.title}
          </button>
        ))}
      </nav>
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
      {activeModuleTab ? (
        <ModuleTabView
          key={activeModuleTab.tabKey}
          tab={activeModuleTab}
          onDisable={(id) => toggleModule(id, false)}
          onAction={(action) => runModuleAction(activeModuleTab.entry.id, action)}
        />
      ) : view === 'status' ? (
        <StatusPanel
          snapshot={snapshot}
          requestError={requestError}
          api={effectiveApi}
          onRetry={() => void retry()}
          onRefresh={() => void refreshRuntime()}
          onSelectDistro={(d) => void selectDistro(d)}
        />
      ) : view === 'sessions' ? (
        <SessionsView api={effectiveApi} />
      ) : view === 'resources' ? (
        <ResourcesView api={effectiveApi} />
      ) : (
        <ModulesView
          entries={moduleEntries}
          diagnostics={loadDiagnostics}
          loading={modulesLoading}
          busyIds={persistingIds}
          onToggle={(id, enabled) => toggleModule(id, enabled)}
        />
      )}
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
    </main>
  );
}
