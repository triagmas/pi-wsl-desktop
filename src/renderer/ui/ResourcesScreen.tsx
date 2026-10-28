/**
 * Design Lab — экран «Ресурсы / Skills» (Issue #21, D1; ref3/ref6).
 * Только представление. C2 (UI21-Migration): controlled-вкладки, настоящий
 * input поиска, select-фильтр источника, слоты баннера/контента и
 * product-тестиды строк — чтобы реальный продукт рендерил тот же контур.
 * Данные лабы — фикстуры; продукт передаёт строки/слоты сам.
 */
import type { ReactNode } from 'react';
import { IconChevronDown, IconDots, IconInfo, IconPlus, IconSearch } from './icons';

export interface ResTab {
  id: string;
  label: string;
  active?: boolean;
}

export interface SkillRow {
  id: string;
  title: string;
  desc: string;
  badge: string;
  icon: ReactNode;
  /** Product contract: testid of the row element (e.g. skill-row). */
  testid?: string;
  /** Product contract: testid of the status/badge element (e.g. skill-status). */
  statusTestid?: string;
  disabled?: boolean;
  /** Slot for row actions (product toggle); defaults to Подробнее/… pair. */
  actions?: ReactNode;
}

export interface ResourcesScreenProps {
  title?: string;
  subtitle?: string;
  /** Root testid (product: resources-view). */
  testid?: string;
  tabs: ResTab[];
  onTabChange?: (id: string) => void;
  searchPlaceholder?: string;
  /** Controlled search — when a change handler exists, a real input renders. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Controlled source filter — renders the approved select instead of a stub. */
  filter?: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    ariaLabel?: string;
  };
  /** Lab stub label for the decorative filter button (no real select). */
  filterLabel?: string;
  installLabel?: string;
  onInstall?: () => void;
  meta?: string;
  metaTestid?: string;
  rows?: SkillRow[];
  note?: string;
  /** Slot right under the tablist (product: error/notice/plan/result). */
  banner?: ReactNode;
  /** Slot under the list (product: panels, empty state, diagnostics). */
  children?: ReactNode;
}

export function ResourcesScreen({
  title = 'Ресурсы',
  subtitle = 'Навыки, расширения и подключения вашего Pi',
  testid,
  tabs,
  onTabChange,
  searchPlaceholder = 'Найти навык…',
  searchValue,
  onSearchChange,
  filter,
  filterLabel = 'Все источники',
  installLabel = 'Установить навык',
  onInstall,
  meta,
  metaTestid,
  rows,
  note,
  banner,
  children,
}: ResourcesScreenProps) {
  return (
    <div className="dl-screen" data-testid={testid}>
      <h1 className="dl-h1">{title}</h1>
      <p className="dl-page-sub dl-screen-sub">{subtitle}</p>

      <nav className="dl-res-tabs" data-testid="res-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-testid={`res-tab-${tab.id}`}
            aria-selected={tab.active}
            className={`dl-res-tab${tab.active ? ' dl-res-tab-active' : ''}`}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {banner}

      <div className="dl-res-toolbar">
        {onSearchChange ? (
          <label className="dl-input-box">
            <IconSearch size={19} strokeWidth={1.7} />
            <input
              type="text"
              className="dl-input-field"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </label>
        ) : (
          <div className="dl-input-box">
            <IconSearch size={19} strokeWidth={1.7} />
            {searchPlaceholder}
          </div>
        )}

        {filter ? (
          <label className="dl-select">
            <select
              className="dl-select-field"
              aria-label={filter.ariaLabel ?? 'Фильтр'}
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
            >
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <IconChevronDown size={17} />
          </label>
        ) : (
          <button type="button" className="dl-select">
            {filterLabel}
            <IconChevronDown size={17} />
          </button>
        )}

        <button type="button" className="dl-btn-primary dl-install" onClick={onInstall}>
          <IconPlus size={21} strokeWidth={2} />
          {installLabel}
        </button>
      </div>

      {meta ? (
        <p className="dl-meta dl-res-meta" data-testid={metaTestid}>
          {meta}
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="dl-list">
          {rows.map((row) => (
            <div key={row.id} className="dl-skill" data-testid={row.testid}>
              <span className="dl-skill-icon" aria-hidden="true">
                {row.icon}
              </span>
              <div className="dl-skill-text">
                <div className="dl-skill-title">{row.title}</div>
                <div className="dl-skill-desc">{row.desc}</div>
              </div>
              <span className="dl-skill-badge" data-testid={row.statusTestid}>
                {row.badge}
              </span>
              {row.actions ?? (
                <>
                  <button type="button" className="dl-skill-link" disabled={row.disabled}>
                    Подробнее
                  </button>
                  <button type="button" className="dl-skill-dots" aria-label="Действия" disabled={row.disabled}>
                    <IconDots size={20} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {children}

      {note ? (
        <p className="dl-note">
          <IconInfo size={18} />
          {note}
        </p>
      ) : null}
    </div>
  );
}
