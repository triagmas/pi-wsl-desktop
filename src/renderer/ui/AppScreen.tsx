/**
 * D3 — ЕДИНСТВЕННАЯ композиция главного экрана (Issue #21, owner #6398531407).
 *
 * Иерархия один в один повторяет принятый Design Lab `AppScreen`
 * (Reference/01-chat-review-terminal): AppFrame → crumb-row → чат-регион,
 * слева Sidebar/Rail, справа details, внизу ui/StatusBar. Разница между
 * Design Lab (fixtures) и Electron (реальные Pi/WSL-данные) — ТОЛЬКО
 * данные и callback-биндинги; никаких fixture-импортов здесь нет.
 */
import type { ReactNode } from 'react';
import { AppFrame, type AppFrameProps } from './AppFrame';
import { StatusBar, type StatusBarProps } from './StatusBar';

export interface AppScreenProps {
  theme?: 'dark' | 'light';
  /** D2/D3 продуктовый контракт testid (app-shell). */
  testid?: string;
  windowControls?: AppFrameProps['windowControls'];
  /** Левая панель: approved-узел <Sidebar> или <Rail>. */
  side: ReactNode;
  /** Прозрачный resize-handle левой панели (данные/функция; лаба не передаёт). */
  sideHandle?: ReactNode;
  /** Правая панель: header (строка колонки) + body + опциональный handle. */
  details?: { header: ReactNode; body: ReactNode; handle?: ReactNode } | null;
  /** Единственная crumb-row главного экрана: crumb слева, actions справа. */
  header: { crumb: ReactNode; actions?: ReactNode };
  /** Страховка переключения сессии / панели модулей / ошибки (Electron). */
  guard?: ReactNode;
  panels?: ReactNode;
  errors?: ReactNode;
  /** Чат-регион: ChatView (лаба) или session/пустое состояние (Electron). */
  body: ReactNode;
  /** Данные статус-бара: лаба — fixtures, Electron — snapshot подключения. */
  statusBar: StatusBarProps;
}

export function AppScreen({
  theme,
  testid,
  windowControls,
  side,
  sideHandle,
  details,
  header,
  guard,
  panels,
  errors,
  body,
  statusBar,
}: AppScreenProps) {
  return (
    <AppFrame
      layout="app"
      theme={theme}
      testid={testid}
      windowControls={windowControls}
      side={
        <>
          {side}
          {sideHandle}
        </>
      }
      details={details}
      statusbarTestId="status-bar"
      statusBar={<StatusBar {...statusBar} />}
    >
      <div className="dl-app-crumb">
        <div className="dl-crumb">{header.crumb}</div>
        {header.actions ? <div className="dl-toolbar-actions">{header.actions}</div> : null}
      </div>
      {guard}
      {panels}
      {body}
      {errors}
    </AppFrame>
  );
}
