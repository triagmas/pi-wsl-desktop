/**
 * Design Lab — экран «Ресурсы / Skills» (Issue #21, D1; ref3/ref6).
 * Только представление: заголовок, вкладки, поиск/фильтр, кнопка установки,
 * список навыков и подсказка. Данные — фикстуры (6 навыков как в эталоне).
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
}

export interface ResourcesScreenProps {
  title?: string;
  subtitle?: string;
  tabs: ResTab[];
  searchPlaceholder?: string;
  filterLabel?: string;
  installLabel?: string;
  meta?: string;
  rows: SkillRow[];
  note?: string;
  onInstall?: () => void;
}

export function ResourcesScreen({
  title = 'Ресурсы',
  subtitle = 'Навыки, расширения и подключения вашего Pi',
  tabs,
  searchPlaceholder = 'Найти навык…',
  filterLabel = 'Все источники',
  installLabel = 'Установить навык',
  meta,
  rows,
  note,
  onInstall,
}: ResourcesScreenProps) {
  return (
    <div className="dl-screen">
      <h1 className="dl-h1">{title}</h1>
      <p className="dl-page-sub dl-screen-sub">{subtitle}</p>

      <div className="dl-res-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.active}
            className={`dl-res-tab${tab.active ? ' dl-res-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="dl-res-toolbar">
        <div className="dl-input-box">
          <IconSearch size={19} strokeWidth={1.7} />
          {searchPlaceholder}
        </div>
        <button type="button" className="dl-select">
          {filterLabel}
          <IconChevronDown size={17} />
        </button>
        <button type="button" className="dl-btn-primary dl-install" onClick={onInstall}>
          <IconPlus size={21} strokeWidth={2} />
          {installLabel}
        </button>
      </div>

      {meta ? <p className="dl-meta dl-res-meta">{meta}</p> : null}

      <div className="dl-list">
        {rows.map((row) => (
          <div key={row.id} className="dl-skill">
            <span className="dl-skill-icon" aria-hidden="true">
              {row.icon}
            </span>
            <div className="dl-skill-text">
              <div className="dl-skill-title">{row.title}</div>
              <div className="dl-skill-desc">{row.desc}</div>
            </div>
            <span className="dl-skill-badge">{row.badge}</span>
            <button type="button" className="dl-skill-link">
              Подробнее
            </button>
            <button type="button" className="dl-skill-dots" aria-label="Действия">
              <IconDots size={20} />
            </button>
          </div>
        ))}
      </div>

      {note ? (
        <p className="dl-note">
          <IconInfo size={18} />
          {note}
        </p>
      ) : null}
    </div>
  );
}
