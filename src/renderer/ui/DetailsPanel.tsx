/**
 * Design Lab — правая панель «Детали действия» (Issue #21, D1; ref1/ref5).
 * Только представление. Заголовок панели + кнопка сворачивания рендерятся
 * в Toolbar (AppFrame details.header), здесь — тело: вкладки, pill, секции.
 * Реальные вкладки «Файлы/Изменения» не выдумываем (design-system.md): данные — фикстура.
 */
import { IconCheckCircle, IconClose, IconDots, IconFileDoc } from './icons';

export interface DetailsTab {
  id: string;
  label: string;
  active?: boolean;
}

export interface DetailsFile {
  id: string;
  name: string;
}

export interface DetailsCheck {
  id: string;
  text: string;
  /** D2: состояние реального инструмента — иконка не выдаёт запущенное за готовое. */
  state?: 'running' | 'done' | 'error';
}

export interface DetailsPanelProps {
  tabs: DetailsTab[];
  pill: string;
  title: string;
  subtitle?: string;
  /** D2: секция «Файлы» рендерится только при непустых files (честное отсутствие). */
  filesLabel?: string;
  files?: DetailsFile[];
  checksLabel: string;
  checks: DetailsCheck[];
  footer?: string;
}

export function DetailsPanel({
  tabs,
  pill,
  title,
  subtitle,
  filesLabel,
  files,
  checksLabel,
  checks,
  footer,
}: DetailsPanelProps) {
  const hasFiles = !!files && files.length > 0;
  return (
    <>
      <div className="dl-details-tabs" role="tablist">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={tab.active} className={`dl-tab${tab.active ? ' dl-tab-active' : ''}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="dl-pill">
        <span className="dl-pill-icon" aria-hidden="true">
          <IconCheckCircle size={19} />
        </span>
        {pill}
      </div>

      <h2 className="dl-h2">{title}</h2>
      {subtitle ? <p className="dl-details-sub">{subtitle}</p> : null}

      <div className="dl-details-divider" />
      {hasFiles ? (
        <div className="dl-details-section">
          <h3 className="dl-section-label">{filesLabel}</h3>
          <div className="dl-file-rows">
            {files?.map((file) => (
              <div key={file.id} className="dl-file">
                <span className="dl-file-icon" aria-hidden="true">
                  <IconFileDoc size={24} />
                </span>
                {file.name}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dl-details-divider dl-details-divider-bottom" />
      <div className="dl-details-section dl-details-section-late">
        <h3 className="dl-section-label">{checksLabel}</h3>
        <div className="dl-check-rows" data-testid="tool-details">
          {checks.map((check) => (
            <div key={check.id} className="dl-check" data-state={check.state}>
              <span className="dl-check-icon" aria-hidden="true">
                {check.state === 'running' ? (
                  <IconDots size={26} />
                ) : check.state === 'error' ? (
                  <IconClose size={24} />
                ) : (
                  <IconCheckCircle size={26} />
                )}
              </span>
              {check.text}
            </div>
          ))}
        </div>
      </div>

      <div className="dl-details-foot-block">
        <div className="dl-details-divider" />
        {footer ? <div className="dl-details-foot">{footer}</div> : null}
      </div>
    </>
  );
}

export function DetailsHeader({
  title,
  collapseTestId,
  onCollapse,
}: {
  title: string;
  /** R07 §1: кнопка сворачивания переехала в шапку чата; параметры сохранены
   *  для обратной совместимости вызовов, но внутри заголовка кнопки больше нет. */
  collapseTestId?: string;
  onCollapse?: () => void;
}) {
  void collapseTestId;
  const collapsed = onCollapse;
  void collapsed;
  return <span className="dl-details-title">{title}</span>;
}