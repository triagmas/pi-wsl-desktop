/**
 * Left sidebar (Issue #21 §2 / R02 A2): the honest «Открыть последний
 * диалог» action (M1 has no create-session RPC — the label never promises
 * creation), search over real session data, projects with nested chats,
 * bottom navigation and the collapse toggle. Collapsed = 48px icon rail
 * (same icon family everywhere, no emoji). Truthful labels: a session shows
 * its real name or the readable file stem — never an opaque id fragment.
 */
import { useEffect, useState } from 'react';
import type { DesktopApi } from '../api';
import { m1 } from '../m1api';
import type { ProjectInfoT, SessionInfoT } from '../types';
import {
  IconChatBubble,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconModules,
  IconPlus,
  IconRailCollapse,
  IconRailExpand,
  IconResources,
  IconSearch,
  IconSettings,
} from './icons';

/** Project display label: the last path segment (ProjectInfoT has no name). */
export function projectName(project: { id: string; path: string }): string {
  const trimmed = project.path.replace(/[\\/]+$/, '');
  const base = trimmed.split(/[\\/]/).pop();
  return base && base.length > 0 ? base : project.path;
}

/**
 * Truthful session label: real name → readable file stem → last resort id
 * prefix (only for files whose stem is empty, e.g. broken paths).
 */
export function sessionLabel(session: { name: string | null; file: string; id: string }): string {
  const name = session.name?.trim();
  if (name) return name;
  const stem = session.file.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.replace(/\.jsonl$/i, '');
  if (stem && stem.length > 0) return stem;
  return session.id.slice(0, 8);
}

export interface SidebarModuleTab {
  tabKey: string;
  title: string;
}

export interface LeftSidebarProps {
  api: DesktopApi | null;
  /** Bridge connection readiness — the list reloads once it flips to true
   *  (the first attempt at mount may race the bridge startup). */
  connectionReady: boolean;
  /** Real WSL distro from the live connection snapshot (status subtitle). */
  distro: string | null;
  /** M3 module tabs stay reachable from the sidebar (§5 keeps the contract). */
  moduleTabs: SidebarModuleTab[];
  collapsed: boolean;
  width: number;
  view: string;
  activeFile: string | null;
  onToggleCollapsed: () => void;
  onNewChat: () => void;
  onView: (view: string) => void;
  onPickSession: (session: SessionInfoT) => void;
  onPickProject: (project: ProjectInfoT) => void;
}

export function LeftSidebar({
  api,
  connectionReady,
  distro,
  moduleTabs,
  collapsed,
  width,
  view,
  activeFile,
  onToggleCollapsed,
  onNewChat,
  onView,
  onPickSession,
  onPickProject,
}: LeftSidebarProps) {
  const [projects, setProjects] = useState<ProjectInfoT[]>([]);
  const [sessions, setSessions] = useState<SessionInfoT[]>([]);
  const [openProjects, setOpenProjects] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [p, s] = await Promise.all([m1.listProjects(api), m1.listSessions(api)]);
        if (cancelled) return;
        // Fail-safe normalization: an unexpected payload must degrade to an
        // honest empty list, never crash the shell (§8 error states).
        const projectList = Array.isArray(p.projects) ? p.projects : [];
        const sessionList = Array.isArray(s.sessions) ? s.sessions : [];
        setProjects(projectList);
        setSessions(sessionList);
        setError(null);
        // First project expands by default so nested chats are discoverable.
        if (projectList.length > 0) {
          setOpenProjects((prev) => (prev.size > 0 ? prev : new Set([projectList[0].id])));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, connectionReady]);

  const q = query.trim().toLowerCase();
  const visibleSessions = q
    ? sessions.filter(
        (s) =>
          (s.name ?? '').toLowerCase().includes(q) ||
          s.file.toLowerCase().includes(q) ||
          s.projectPath.toLowerCase().includes(q),
      )
    : sessions;
  const visibleProjects = q
    ? projects.filter(
        (p) =>
          projectName(p).toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          visibleSessions.some((s) => s.projectId === p.id),
      )
    : projects;

  const newChatTitle =
    'Создание новых сессий доступно в Pi CLI — здесь открывается самый свежий существующий диалог';

  return (
    <aside
      data-testid="left-sidebar"
      data-collapsed={collapsed ? '' : null}
      className={`left-sidebar${collapsed ? ' sidebar-collapsed' : ''}`}
      style={collapsed ? undefined : { width: `${width}px` }}
      aria-label="Проекты и диалоги"
    >
      <div className="sidebar-top">
        <button
          type="button"
          data-testid="sidebar-collapse"
          className="icon-btn"
          title={collapsed ? 'Показать проекты' : 'Скрыть проекты'}
          aria-label={collapsed ? 'Показать проекты' : 'Скрыть проекты'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <IconRailExpand /> : <IconRailCollapse />}
        </button>
        <button
          type="button"
          data-testid="nav-chat"
          className="icon-btn"
          title="Чат"
          aria-label="Чат"
          aria-current={view === 'chat'}
          onClick={() => onView('chat')}
        >
          <span className="brand-mark brand-mark-nav" aria-hidden="true">
            π
          </span>
        </button>
      </div>

      {collapsed && (
        <div className="rail-actions">
          <button
            type="button"
            data-testid="rail-new-chat"
            className="icon-btn"
            title={newChatTitle}
            aria-label="Открыть последний диалог"
            onClick={onNewChat}
          >
            <IconPlus />
          </button>
          <button
            type="button"
            data-testid="rail-search"
            className="icon-btn"
            title="Показать проекты и поиск"
            aria-label="Показать проекты и поиск"
            onClick={onToggleCollapsed}
          >
            <IconSearch />
          </button>
        </div>
      )}

      {!collapsed && (
        <div data-testid="sidebar-projects" className="sidebar-scroll">
          <button
            type="button"
            data-testid="sidebar-new-chat"
            className="btn-primary sidebar-new"
            title={newChatTitle}
            onClick={onNewChat}
          >
            <IconPlus />
            <span>Открыть последний диалог</span>
          </button>

          <label className="sidebar-search">
            <span className="visually-hidden">Поиск чатов</span>
            <IconSearch className="sidebar-search-icon" />
            <input
              data-testid="sidebar-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={q ? 'Поиск по названиям и файлам…' : 'Поиск чатов'}
              aria-label="Поиск чатов по названию и файлу"
            />
          </label>
          {q && (
            <p className="sidebar-search-note muted" data-testid="search-scope">
              Поиск по названиям и путям сессий
            </p>
          )}
          {error && (
            <p className="request-error" role="alert" data-testid="sidebar-error">
              {error}
            </p>
          )}

          <div className="sidebar-section-label">Проекты</div>
          <ul className="project-list" data-testid="project-list">
            {visibleProjects.length === 0 && !q && (
              <li className="muted sidebar-empty">Проекты не найдены</li>
            )}
            {visibleProjects.map((p) => {
              const open = q ? true : openProjects.has(p.id);
              const own = visibleSessions.filter((s) => s.projectId === p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="project-row"
                    data-testid={`project-${p.id}`}
                    aria-expanded={open}
                    onClick={() => {
                      onPickProject(p);
                      setOpenProjects((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      });
                    }}
                  >
                    <IconFolder className="row-icon" />
                    <span className="project-name">{projectName(p)}</span>
                    {open ? (
                      <IconChevronDown className="chevron" />
                    ) : (
                      <IconChevronRight className="chevron" />
                    )}
                  </button>
                  {open && (
                    <ul className="session-list">
                      {own.length === 0 && <li className="muted sidebar-empty">Чатов нет</li>}
                      {own.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            data-testid={`session-${s.id}`}
                            className={`session-row${s.file === activeFile ? ' session-active' : ''}`}
                            aria-current={s.file === activeFile}
                            onClick={() => onPickSession(s)}
                          >
                            <IconChatBubble className="row-icon" />
                            <span className="session-row-name">{sessionLabel(s)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            {q && visibleProjects.length === 0 && (
              <li className="muted sidebar-empty">Ничего не найдено</li>
            )}
          </ul>
        </div>
      )}

      <nav className="sidebar-nav" aria-label="Разделы">
        {moduleTabs.length > 0 && !collapsed && (
          <div className="module-tab-nav" data-testid="module-tab-nav">
            {moduleTabs.map(({ tabKey, title }) => (
              <button
                key={tabKey}
                type="button"
                data-testid={`tab-module-${tabKey}`}
                className={`nav-item nav-sub${view === `module:${tabKey}` ? ' nav-current' : ''}`}
                aria-current={view === `module:${tabKey}`}
                onClick={() => onView(`module:${tabKey}`)}
              >
                <span aria-hidden="true" className="nav-dot" />
                <span className="nav-label">{title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="sidebar-nav-spacer" />
        <button
          type="button"
          data-testid="nav-resources"
          className="nav-item"
          title="Ресурсы"
          aria-label="Ресурсы"
          aria-current={view === 'resources'}
          onClick={() => onView('resources')}
        >
          <IconResources className="nav-icon" />
          {!collapsed && <span className="nav-label">Ресурсы</span>}
        </button>
        <button
          type="button"
          data-testid="nav-modules"
          className="nav-item"
          title="Модули"
          aria-label="Модули"
          aria-current={view === 'modules' || view.startsWith('module:')}
          onClick={() => onView('modules')}
        >
          <IconModules className="nav-icon" />
          {!collapsed && <span className="nav-label">Модули</span>}
        </button>
        <button
          type="button"
          data-testid="nav-settings"
          className="nav-item"
          title="Настройки"
          aria-label="Настройки"
          aria-current={view === 'settings'}
          onClick={() => onView('settings')}
        >
          <IconSettings className="nav-icon" />
          {!collapsed && <span className="nav-label">Настройки</span>}
        </button>
        <div data-testid="sidebar-connection" className="sidebar-connection">
          <span
            className={`conn-dot${connectionReady ? '' : ' conn-dot-pending'}`}
            aria-hidden="true"
          />
          {!collapsed && (
            <span className="nav-label muted connection-label">
              {connectionReady ? 'Pi подключён' : 'Подключение…'}
              <span className="connection-sub">
                {distro ? `${distro} · WSL` : 'WSL'}
              </span>
            </span>
          )}
        </div>
      </nav>
    </aside>
  );
}
