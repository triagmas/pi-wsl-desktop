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
  /** D2: data-testid строки сессии (продуктовый тест/е2е не ломается). */
  testid?: string;
}

export interface SidebarProject {
  id: string;
  name: string;
  expanded?: boolean;
  /** app (эталон 01-…): зелёная точка состояния рядом с именем проекта. */
  dot?: boolean;
  /** app: подпись под именем (например ветка «main»). */
  sub?: string;
  sessions?: SidebarSession[];
  testid?: string;
}

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  testid?: string;
  title?: string;
}

export interface SidebarProps {
  projects: SidebarProject[];
  nav: SidebarNavItem[];
  /** id активной сессии (подсветка строки); у экранов Resources — undefined. */
  activeSessionId?: string;
  /** app (D1-этап 2): верхняя строка панели — «Открыть проект» + сворачивание. */
  header?: ReactNode;
  /** app: заголовок раздела (эталон 01-… — «Проекты» строчными + шеврон). */
  projectsTitle?: ReactNode;
  /** app: порядок верхних строк как в эталоне 01-chat-review-terminal (поиск → новый). */
  searchFirst?: boolean;
  searchPlaceholder?: string;
  /** D2: управляемый поиск — без обработчика остаётся статичный вид design-lab. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** D2: подпись кнопки. По умолчанию — design-lab «Новый диалог». */
  newChatLabel?: string;
  /** D2: данные строки подключения (продукт: реальное состояние Pi). */
  connection?: { label: string; detail?: string; testid?: string };
  /** D2: блок уведомлений (например ошибка загрузки списка сессий). */
  notice?: ReactNode;
  /** D3: продуктовый testid корня (e2e/тесты общей композиции). */
  testid?: string;
  /** D3: признак свёрнутого состояния (контракт data-collapsed). */
  dataCollapsed?: boolean;
  /** D3: живая ширина (Electron drag-preview); Design Lab width не передаёт
   * и следует CSS-переменным оболочки. */
  width?: number;
  /** D3: testid списка проектов/сессий (m1 discovery-контракт). */
  projectsTestId?: string;
  onNewChat?: () => void;
  onToggleProject?: (id: string) => void;
  onSelectSession?: (id: string) => void;
  onNavigate?: (id: string) => void;
}

export function Sidebar({
  width,
  projects,
  nav,
  activeSessionId,
  testid,
  dataCollapsed,
  projectsTestId,
  header,
  projectsTitle,
  searchFirst,
  searchPlaceholder = 'Поиск чатов',
  searchValue,
  onSearchChange,
  newChatLabel = 'Новый диалог',
  connection,
  notice,
  onNewChat,
  onToggleProject,
  onSelectSession,
  onNavigate,
}: SidebarProps) {
  const search = onSearchChange ? (
    <label className="dl-search">
      <IconSearch size={19} strokeWidth={1.7} />
      <input
        type="search"
        className="dl-search-input"
        value={searchValue ?? ''}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
      />
    </label>
  ) : (
    <div className="dl-search">
      <IconSearch size={19} strokeWidth={1.7} />
      {searchPlaceholder}
    </div>
  );
  const newChat = (
    <button type="button" className="dl-newchat" onClick={onNewChat}>
      <IconPlus size={22} strokeWidth={2} />
      {newChatLabel}
    </button>
  );
  return (
    <div
      className="dl-sidebar"
      data-testid={testid}
      data-collapsed={dataCollapsed ? '' : null}
      style={width === undefined ? undefined : { width: `${width}px` }}
    >
      {header ? <div className="dl-sidebar-head">{header}</div> : null}
      {notice ? <div className="dl-sidebar-notice">{notice}</div> : null}
      <div className="dl-sidebar-top">
        {searchFirst ? (
          <>
            {search}
            {newChat}
          </>
        ) : (
          <>
            {newChat}
            {search}
          </>
        )}
      </div>

      <div className="dl-side-label dl-side-label-first">{projectsTitle ?? 'Проекты'}</div>
      <div className="dl-tree" data-testid={projectsTestId}>
        {projects.map((project) => (
          <div key={project.id}>
            <button
              type="button"
              className="dl-row dl-row-project project-row"
              aria-expanded={project.expanded}
              data-testid={project.testid}
              onClick={() => onToggleProject?.(project.id)}
            >
              <IconFolder size={20} />
              {project.dot ? <span className="dl-row-dot" aria-hidden="true" /> : null}
              <span className="dl-row-text">
                {project.name}
                {project.sub ? <span className="dl-row-sub">{project.sub}</span> : null}
              </span>
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
                    className={`dl-row dl-row-session session-row${session.id === activeSessionId ? ' dl-row-active' : ''}`}
                    data-testid={session.testid}
                    aria-current={session.id === activeSessionId}
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
            data-testid={item.testid}
            title={item.title}
            aria-current={item.active}
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
        <div className="dl-conn" data-testid={connection.testid}>
          <div className="dl-conn-main">
            <span className="dl-conn-dot" aria-hidden="true" />
            {connection.label}
          </div>
          {connection.detail ? <div className="dl-conn-detail">{connection.detail}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
