/**
 * Left sidebar (D2): контейнер реальных данных m1 (проекты/сессии/поиск/
 * сворачивание) + одобренная презентация ui/Sidebar (развёрнута) или ui/Rail
 * (свернута) с handle изменения ширины. Никаких fixture-данных.
 *
 * «Новый диалог» подписан честно («Открыть последний диалог»): Bridge M1 не
 * умеет создавать сессии (ALL_METHODS), выдавать открытие свежей сессии за
 * создание запрещено решением владельца #6395777040.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { m1 } from '../m1api';
import type { DesktopApi } from '../api';
import type { SessionInfoT, ProjectInfoT } from '../types';
import { Sidebar, type SidebarNavItem, type SidebarProject } from '../ui/Sidebar';
import { Rail } from '../ui/Rail';
import {
  IconChatBubble,
  IconCode,
  IconDatabase,
  IconFolder,
  IconGear,
  IconPanelExpand,
  IconPuzzle,
} from '../ui/icons';
import { useResizeHandle } from './useResizeHandle';

export interface LeftSidebarProps {
  api: DesktopApi | null;
  connectionReady: boolean;
  moduleTabs: Array<{ tabKey: string; title: string }>;
  collapsed: boolean;
  /** Эффективная ширина (stored + preview) — inline-стиль а사이да. */
  width: number;
  view: string;
  activeFile: string | null;
  onToggleCollapsed: () => void;
  onNewChat: () => void;
  onView: (view: string) => void;
  onPickSession: (session: SessionInfoT) => void;
  /** Живой предпросмотр ширины (без записи) во время drag. */
  onWidthPreview?: (width: number) => void;
  /** Фиксация ширины (persist appearance): drag-end или клавиша. */
  onWidthCommit?: (width: number) => void;
}

function projectName(project: ProjectInfoT): string {
  return project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path;
}

const LEFT_MIN = 200;
const LEFT_MAX = 480;

export function LeftSidebar({
  api,
  connectionReady,
  moduleTabs,
  collapsed,
  width,
  view,
  activeFile,
  onToggleCollapsed,
  onNewChat,
  onView,
  onPickSession,
  onWidthPreview,
  onWidthCommit,
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

  const activeSessionId = activeFile
    ? sessions.find((s) => s.file === activeFile)?.id
    : undefined;

  const sidebarProjects: SidebarProject[] = visibleProjects.map((p) => ({
    id: p.id,
    name: projectName(p),
    expanded: q ? true : openProjects.has(p.id),
    testid: `project-${p.id}`,
    sessions: visibleSessions
      .filter((s) => s.projectId === p.id)
      .map((s) => ({
        id: s.id,
        title: s.name ?? s.id.slice(0, 8),
        testid: `session-${s.id}`,
      })),
  }));

  const nav: SidebarNavItem[] = [
    { id: 'chat', label: 'Чат', icon: <IconChatBubble size={20} />, active: view === 'chat', testid: 'nav-chat' },
    ...moduleTabs.map(({ tabKey, title }) => ({
      id: `module:${tabKey}`,
      label: title,
      icon: <IconCode size={20} />,
      active: view === `module:${tabKey}`,
      testid: `tab-module-${tabKey}`,
    })),
    {
      id: 'resources',
      label: 'Ресурсы',
      icon: <IconDatabase size={20} />,
      active: view === 'resources',
      testid: 'nav-resources',
    },
    {
      id: 'modules',
      label: 'Модули',
      icon: <IconPuzzle size={20} />,
      active: view === 'modules' || view.startsWith('module:'),
      testid: 'nav-modules',
    },
    {
      id: 'settings',
      label: 'Настройки',
      icon: <IconGear size={20} />,
      active: view === 'settings',
      testid: 'nav-settings',
    },
  ];

  const resize = useResizeHandle({
    axis: 'x',
    value: width,
    min: LEFT_MIN,
    max: LEFT_MAX,
    onPreview: (w) => onWidthPreview?.(w),
    onCommit: (w) => onWidthCommit?.(w),
  });

  // Rail (свёрнутое состояние): всё, кроме «Настройки», — сверху;
  // «Настройки» + точка подключения — снизу (ref1/ref5 layout).
  const stripActive = (item: SidebarNavItem): { id: string; label: string; icon: ReactNode; testid?: string; title: string } => {
    const { icon, id, label, testid } = item;
    return { id, label, icon, testid, title: label };
  };
  const railTop = nav.filter((item) => item.id !== 'settings').map(stripActive);
  const railBottom = nav.filter((item) => item.id === 'settings').map(stripActive);

  const collapseToggle = (
    <button
      type="button"
      className="dl-btn-ghost dl-side-collapse"
      data-testid="sidebar-collapse"
      title={collapsed ? 'Показать проекты' : 'Скрыть проекты'}
      aria-label={collapsed ? 'Показать проекты' : 'Скрыть проекты'}
      aria-expanded={!collapsed}
      onClick={onToggleCollapsed}
    >
      <IconPanelExpand size={20} />
    </button>
  );

  const notice = error ? (
    <p className="request-error" role="alert" data-testid="sidebar-error">
      {error}
    </p>
  ) : null;

  // D3 (owner #6398531407): без собственных обёрток — approved-узлы
  // Sidebar/Rail идут напрямую в .dl-side (ширина — grid-трек --dl-app-side-w),
  // resize-handle остаётся прямым братом-узлом в слоте side.
  return (
    <>
      {collapsed ? (
        <Rail
          testid="left-sidebar"
          dataCollapsed
          top={[
            {
              id: 'sidebar-expand',
              label: 'Показать проекты',
              title: 'Показать проекты',
              testid: 'sidebar-collapse',
              icon: <IconPanelExpand size={20} />,
            },
            ...railTop,
          ]}
          bottom={railBottom}
          connectionDot={connectionReady}
          onItemClick={(id) => {
            if (id === 'sidebar-expand') onToggleCollapsed();
            else onView(id);
          }}
        />
      ) : (
          <Sidebar
            testid="left-sidebar"
            width={width}
            projectsTestId="project-list"
            header={
              <>
                {/* C1/P3: эталонная шапка 01 — статичный span-заголовок
                    (действия открытия проекта в мосту нет — честно) */}
                <span className="dl-sidebar-head-main">
                  <IconFolder size={20} />
                  Открыть проект
                </span>
                {collapseToggle}
              </>
            }
            notice={notice}
            searchFirst
            searchPlaceholder={q ? 'Поиск по названиям и файлам…' : 'Поиск чатов'}
            searchValue={query}
            onSearchChange={setQuery}
            newChatLabel="Открыть последний диалог"
            projectsTitle="Проекты"
            projects={sidebarProjects}
            activeSessionId={activeSessionId}
            nav={nav}
            connection={{
              label: connectionReady ? 'Pi подключён' : 'Подключение…',
              testid: 'sidebar-connection',
            }}
            onNewChat={onNewChat}
            onToggleProject={(id) =>
              setOpenProjects((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectSession={(id) => {
              const session = sessions.find((s) => s.id === id);
              if (session) onPickSession(session);
            }}
            onNavigate={(id) => onView(id)}
          />
      )}
      {!collapsed && (
        <div
          className="dl-resize dl-resize-x dl-resize-left"
          role="separator"
          aria-label="Ширина левой панели"
          aria-orientation="vertical"
          aria-valuenow={width}
          aria-valuemin={LEFT_MIN}
          aria-valuemax={LEFT_MAX}
          tabIndex={0}
          data-testid="resize-left"
          onMouseDown={resize.onMouseDown}
          onKeyDown={resize.onKeyDown}
        />
      )}
    </>
  );
}
