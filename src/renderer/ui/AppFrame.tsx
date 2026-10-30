/**
 * Design Lab — каркас приложения (Issue #21, D1). Чистая композиция слотов:
 * TitleBar (+Toolbar в split), левая панель (Sidebar/Rail), main, DetailsPanel,
 * StatusBar. Никаких API/IPC/bridge-импортов — только React-пропсы.
 */
import type { ReactNode, Ref } from 'react';
import { TitleBar } from './TitleBar';

export type AppLayout = 'inline' | 'split' | 'app';

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
  /** split: правая панель; header рендерится в Toolbar, body — в колонке details.
   * app (D1-этап 2): header — строка колонки (вкладки), body — под ней. */
  details?: { header: ReactNode; body: ReactNode; handle?: ReactNode } | null;
  /** UI26-A2: ссылка на колонку деталей — фокус при открытии и Escape-закрытии. */
  detailsRef?: React.Ref<HTMLElement>;
  statusBar?: ReactNode | null;
  /** D3: testid футура статус-бара (продуктовый контракт e2e/тестов). */
  statusbarTestId?: string;
  /** D2: data-testid (продуктовый контракт App shell). */
  testid?: string;
  /** D2: обработчики оконных кнопок TitleBar (frameless). */
  windowControls?: {
    onMinimize?: () => void;
    onMaximize?: () => void;
    onClose?: () => void;
  };
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
  detailsRef,
  statusBar,
  statusbarTestId,
  theme,
  terminal,
  testid,
  windowControls,
  children,
}: AppFrameProps) {
  const split = layout === 'split';
  return (
    <div
      className="dl-frame"
      data-testid={testid}
      data-layout={layout}
      data-theme={theme}
      data-terminal={terminal ? 'on' : undefined}
      data-details={details ? 'on' : undefined}
      data-statusbar={statusBar ? 'on' : undefined}
    >
      <TitleBar
        breadcrumb={layout === 'inline' ? breadcrumb : undefined}
        onMinimize={windowControls?.onMinimize}
        onMaximize={windowControls?.onMaximize}
        onClose={windowControls?.onClose}
      />
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
      <main className="dl-main">
        {/* children живут в цепочке центра: .center-workspace (flex-column,
         * min-height:0) — точка входа для тестов и e2e. */}
        <div className="center-workspace" data-testid="center-workspace">
          {children}
        </div>
      </main>
      {details ? (
        <aside className="dl-details" ref={detailsRef as Ref<HTMLElement>} tabIndex={-1}>
          {layout === 'app' ? (
            <>
              <div className="dl-details-head">{details.header}</div>
              <div className="dl-details-body">{details.body}</div>
              {details.handle}
            </>
          ) : (
            details.body
          )}
        </aside>
      ) : null}
      {statusBar ? (
        <footer className="dl-status" data-testid={statusbarTestId}>
          {statusBar}
        </footer>
      ) : null}
    </div>
  );
}
