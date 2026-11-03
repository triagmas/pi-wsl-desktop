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
  /** UI26 R02: data-testid кнопки `+` рядом с проектом. */
  newChatTestId?: string;
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
  /**
   * R01 (#6559283775): «Проекты» — группа. Заголовок со стрелкой сворачивает
   * ВЕСЬ список проектов; отдельные проекты по-прежнему сворачиваются сами.
   * Без обработчика (Design Lab board) остаётся статичный заголовок.
   */
  projectsExpanded?: boolean;
  onToggleProjects?: () => void;
  /** Обновление списка из контекста заголовка (правый клик) — без кнопки в шапке. */
  onRefreshProjects?: () => void;
  /** Идёт перечитывание списка (aria-busy у заголовка группы). */
  projectsBusy?: boolean;
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
  /**
   * UI26 R02: `+` у конкретного проекта. Отдельная кнопка-СОСЕД строки проекта
   * (вкладывать button в button нельзя: невалидный HTML и сломанный фокус).
   */
  onNewChatInProject?: (projectId: string) => void;
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
  projectsExpanded = true,
  onToggleProjects,
  onRefreshProjects,
  projectsBusy = false,
  searchFirst,
  searchPlaceholder = 'Поиск чатов',
  searchValue,
  onSearchChange,
  newChatLabel = 'Новый диалог',
  connection,
  notice,
  onNewChat,
  onNewChatInProject,
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
      {/* C1/P5: подпись в отдельном span — nowrap/ellipsis не даёт длинной
          честной подписи переноситься на две строки (appShell-контракт) */}
      <span className="dl-newchat-text">{newChatLabel}</span>
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

      {onToggleProjects ? (
        <button
          type="button"
          className="dl-side-label dl-side-label-first dl-side-label-btn"
          data-testid="projects-toggle"
          aria-expanded={projectsExpanded}
          aria-controls="dl-project-tree"
          aria-busy={projectsBusy}
          title="Проекты — свернуть или развернуть; правый клик — обновить список"
          onClick={onToggleProjects}
          onContextMenu={(e) => {
            if (!onRefreshProjects) return;
            e.preventDefault();
            onRefreshProjects();
          }}
        >
          <span className="dl-side-label-app">
            {projectsExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {projectsTitle ?? 'Проекты'}
          </span>
        </button>
      ) : (
        <div className="dl-side-label dl-side-label-first">{projectsTitle ?? 'Проекты'}</div>
      )}
      {projectsExpanded ? (
      <div className="dl-tree" id="dl-project-tree" data-testid={projectsTestId}>
        {projects.map((project) => (
          <div key={project.id}>
            <div className="dl-row-slot">
            <button
              type="button"
              className="dl-row dl-row-project project-row"
              aria-expanded={project.expanded}
              data-testid={project.testid}
              onClick={() => onToggleProject?.(project.id)}
            >
              {/* R02: одна колонка иконок 16 px — глиф и статус-точка не
                  сдвигают текст вправо. */}
              <span className="dl-row-icon" aria-hidden="true">
                <IconFolder size={16} />
                {project.dot ? <span className="dl-row-dot" /> : null}
              </span>
              <span className="dl-row-text">
                {project.name}
                {project.sub ? <span className="dl-row-sub">{project.sub}</span> : null}
              </span>
              <span className="dl-row-chevron" aria-hidden="true">
                {project.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </span>
            </button>
            {onNewChatInProject ? (
              <button
                type="button"
                className="dl-btn-ghost dl-project-new"
                data-testid={project.newChatTestId ?? `project-new-${project.id}`}
                aria-label={`Новый диалог в проекте ${project.name}`}
                title={`Новый диалог в проекте ${project.name}`}
                onClick={() => onNewChatInProject(project.id)}
              >
                <IconPlus size={14} strokeWidth={2} />
              </button>
            ) : null}
            </div>
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
                    <span className="dl-row-icon" aria-hidden="true">
                      <IconChatBubble size={16} />
                    </span>
                    <span className="dl-row-text" title={session.title}>
                      {session.title}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      ) : null}

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
            <span className="dl-row-icon" aria-hidden="true">
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
