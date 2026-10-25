/**
 * Design Lab — развёрнутая левая панель (Issue #21, D1; состояния ref2–ref4, ref6).
 * Только представление: дерево проектов/чатов, раздел «ПРОЕКТЫ», под-навигация
 * и блок подключения — всё приходит пропсами (фикстуры design-lab/fixtures.ts).
 */
import type { ReactNode } from 'react';
import { IconChatBubble, IconChevronDown, IconChevronRight, IconFolder, IconPlus, IconSearch } from './icons';

export interface SidebarSession {
  id: string;
  title: string;
}

export interface SidebarProject {
  id: string;
  name: string;
  expanded?: boolean;
  sessions?: SidebarSession[];
}

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

export interface SidebarProps {
  projects: SidebarProject[];
  nav: SidebarNavItem[];
  /** id активной сессии (подсветка строки); у экранов Resources — undefined. */
  activeSessionId?: string;
  searchPlaceholder?: string;
  connection?: { label: string; detail: string };
  onNewChat?: () => void;
  onToggleProject?: (id: string) => void;
  onSelectSession?: (id: string) => void;
  onNavigate?: (id: string) => void;
}

export function Sidebar({
  projects,
  nav,
  activeSessionId,
  searchPlaceholder = 'Поиск чатов',
  connection,
  onNewChat,
  onToggleProject,
  onSelectSession,
  onNavigate,
}: SidebarProps) {
  return (
    <div className="dl-sidebar">
      <div className="dl-sidebar-top">
        <button type="button" className="dl-newchat" onClick={onNewChat}>
          <IconPlus size={22} strokeWidth={2} />
          Новый диалог
        </button>
        <div className="dl-search">
          <IconSearch size={19} strokeWidth={1.7} />
          {searchPlaceholder}
        </div>
      </div>

      <div className="dl-side-label dl-side-label-first">Проекты</div>
      <div className="dl-tree">
        {projects.map((project) => (
          <div key={project.id}>
            <button
              type="button"
              className="dl-row dl-row-project"
              aria-expanded={project.expanded}
              onClick={() => onToggleProject?.(project.id)}
            >
              <IconFolder size={20} />
              <span className="dl-row-text">{project.name}</span>
              <span className="dl-row-chevron" aria-hidden="true">
                {project.expanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </span>
            </button>
            {project.expanded && project.sessions?.length ? (
              <div className="dl-tree-rows">
                {project.sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`dl-row dl-row-session${session.id === activeSessionId ? ' dl-row-active' : ''}`}
                    onClick={() => onSelectSession?.(session.id)}
                  >
                    <IconChatBubble size={20} />
                    <span className="dl-row-text">{session.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="dl-side-divider" />
      <div className="dl-nav-rows">
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dl-row dl-row-nav${item.active ? ' dl-row-active' : ''}`}
            onClick={() => onNavigate?.(item.id)}
          >
            <span aria-hidden="true" style={{ display: 'flex' }}>
              {item.icon}
            </span>
            <span className="dl-row-text">{item.label}</span>
          </button>
        ))}
      </div>

      {connection ? (
        <div className="dl-conn">
          <div className="dl-conn-main">
            <span className="dl-conn-dot" aria-hidden="true" />
            {connection.label}
          </div>
          <div className="dl-conn-detail">{connection.detail}</div>
        </div>
      ) : null}
    </div>
  );
}
