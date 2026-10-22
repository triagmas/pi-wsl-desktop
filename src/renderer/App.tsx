import { useState } from 'react';
import './index.css';
import { getDesktopApi, type DesktopApi } from './api';
import { StatusPanel } from './StatusPanel';
import { SessionsView } from './SessionsView';
import { ResourcesView } from './ResourcesView';
import { ModulesView } from './ModulesView';
import { ModuleBlocks, ModuleTabView } from './ModuleTabView';
import type { ModuleAction } from '../shared/m3Protocol';
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

  const toggleModule = (moduleId: string, enabled: boolean) => {
    setModuleEntries((entries) => setModuleEnabled(entries, moduleId, enabled));
    // Leaving a module tab when its module gets disabled keeps the app sane.
    if (!enabled) {
      setView((current) =>
        current.startsWith(`module:${moduleId}/`) ? 'status' : current,
      );
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
   */
  const runModuleAction = (action: ModuleAction) => {
    switch (action.operation) {
      case 'openTab': {
        const exact = action.target && tabs.some((t) => t.tabKey === action.target)
          ? action.target
          : tabs.find((t) => t.entry.id === (action.target ?? ''))?.tabKey
            ?? tabs.find((t) => t.entry.id === activeModuleTab?.entry.id)?.tabKey;
        if (exact) {
          setActionError(null);
          setView(`module:${exact}`);
        } else {
          setActionError(`Действие «${action.id}»: вкладка назначения не найдена`);
        }
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
          {panels.map(({ tabKey, tab }) => (
            <aside
              key={tabKey}
              className="module-panel"
              data-testid={`module-panel-${tabKey}`}
            >
              <h3 className="module-panel-title">{tab.title}</h3>
              <ModuleBlocks blocks={tab.blocks} />
            </aside>
          ))}
        </section>
      )}
      {activeModuleTab ? (
        <ModuleTabView
          key={activeModuleTab.tabKey}
          tab={activeModuleTab}
          onDisable={(id) => toggleModule(id, false)}
          onAction={runModuleAction}
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
          onToggle={(id, enabled) => toggleModule(id, enabled)}
        />
      )}
      {actionError && (
        <p className="request-error" role="alert" data-testid="module-action-error">
          {actionError}
        </p>
      )}
    </main>
  );
}
