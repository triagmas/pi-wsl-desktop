/**
 * Design Lab — каркас приложения (Issue #21, D1). Чистая композиция слотов:
 * TitleBar (+Toolbar в split), левая панель (Sidebar/Rail), main, DetailsPanel,
 * StatusBar. Никаких API/IPC/bridge-импортов — только React-пропсы.
 */
import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';

export type AppLayout = 'inline' | 'split';

export interface AppFrameProps {
  layout: AppLayout;
  /** Содержимое левой панели: <Sidebar> или <Rail>. */
  side: ReactNode;
  /** inline → в TitleBar; split → в Toolbar (left offset 188px от края main). */
  breadcrumb?: ReactNode;
  /** split: кнопка-тумблер rail в Toolbar (левая ячейка). */
  railToggle?: ReactNode;
  /** split: кнопки справа в Toolbar (например, dots + разворот). */
  toolbarActions?: ReactNode;
  /** split: правая панель; header рендерится в Toolbar, body — в колонке details. */
  details?: { header: ReactNode; body: ReactNode } | null;
  statusBar?: ReactNode | null;
  /** data-terminal="on" → компактные инсеты сообщений/композера (ref5). */
  /** data-theme → тема-зависимые mapping-правила (например, user-bubble = surface в dark). */
  theme?: 'dark' | 'light';
  terminal?: boolean;
  children: ReactNode;
}

export function AppFrame({
  layout,
  side,
  breadcrumb,
  railToggle,
  toolbarActions,
  details,
  statusBar,
  theme,
  terminal,
  children,
}: AppFrameProps) {
  const split = layout === 'split';
  return (
    <div
      className="dl-frame"
      data-layout={layout}
      data-theme={theme}
      data-terminal={terminal ? 'on' : undefined}
      data-statusbar={statusBar ? 'on' : undefined}
    >
      <TitleBar breadcrumb={split ? undefined : breadcrumb} />
      {split ? (
        <div className="dl-toolbar">
          <div className="dl-toolbar-rail">{railToggle}</div>
          <div className="dl-toolbar-main">
            <div className="dl-crumb">{breadcrumb}</div>
            {toolbarActions ? <div className="dl-toolbar-actions">{toolbarActions}</div> : null}
          </div>
          {details ? (
            <div className="dl-toolbar-details">
              {details.header}
            </div>
          ) : (
            <span />
          )}
        </div>
      ) : null}
      <div className="dl-side">{side}</div>
      <main className="dl-main">{children}</main>
      {details ? <aside className="dl-details">{details.body}</aside> : null}
      {statusBar ? <footer className="dl-status">{statusBar}</footer> : null}
    </div>
  );
}
