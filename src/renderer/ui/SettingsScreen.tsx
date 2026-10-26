/**
 * Design Lab — экран «Настройки» (Issue #21, D1).
 *
 * Среди шести эталонов экрана Настройки НЕТ (mockup 1–6 = чаты и Ресурсы),
 * поэтому этот компонент собирается из design-system.md/§9.3-контракта:
 * секции «Внешний вид / Типографика / Рабочее пространство / Подключение»,
 * 5 тем (4 пресета + «Своя тема») и 8 независимых типографических зон.
 * Фикстура недоступна только для чтения: значения — из shared/appearance,
 * предпросмотр зон — var(--pw-font-<area>-*) (applyTypography).
 */
import type { ReactNode } from 'react';
import { TYPOGRAPHY_AREAS, defaultTypography, type TypographyArea } from '../../shared/appearance';
import { PRESET_IDS, THEME_PRESETS } from '../../shared/design/presets';

export interface SettingsScreenProps {
  activeThemeId?: string;
  connection?: { label: string; detail: string };
  /** Root testid (product: settings-root). */
  testid?: string;
  /** Product slot — when set, only the approved contour (h1/sub) renders around it. */
  children?: ReactNode;
}

const AREA_LABELS: Record<TypographyArea, string> = {
  ui: 'Интерфейс (ui)',
  sidebar: 'Боковая панель (sidebar)',
  chatInput: 'Поле ввода (chatInput)',
  chatResponse: 'Ответы Pi (chatResponse)',
  code: 'Код (code)',
  toolOutput: 'Вывод инструментов (toolOutput)',
  terminal: 'Терминал (terminal)',
  statusBar: 'Статус-бар (statusBar)',
};

/** Имена --pw-* для мини-превью темы (без литералов цветов). */
const THEME_SWATCHES = [
  '--pw-window-background-color',
  '--pw-sidebar-left-background-color',
  '--pw-surface-background-color',
  '--pw-accent-color',
];

export function SettingsScreen({ activeThemeId, connection, testid, children }: SettingsScreenProps) {
  const typography = defaultTypography();
  const themes = [
    ...PRESET_IDS.map((id) => ({ id, label: THEME_PRESETS[id].label })),
    { id: 'custom', label: 'Своя тема' },
  ];

  return (
    <div className="dl-screen" data-testid={testid}>
      <h1 className="dl-h1">Настройки</h1>
      <p className="dl-page-sub dl-screen-sub">Внешний вид, типографика и подключение Pi</p>

      {children ?? (
        <>
      <section className="dl-set-section">
        <h2>Внешний вид</h2>
        <p className="dl-set-section-sub">Тема применяется к документу; Pi-данные не затрагиваются.</p>
        <div className="dl-theme-grid">
          {themes.map((theme) => (
            <div key={theme.id} className={`dl-theme-card${theme.id === activeThemeId ? ' dl-theme-card-active' : ''}`}>
              <div style={{ fontWeight: 600 }}>{theme.label}</div>
              <div className="dl-theme-swatches" aria-hidden="true">
                {THEME_SWATCHES.map((token) => (
                  <span
                    key={token}
                    className="dl-theme-swatch"
                    style={{ background: `var(${token})` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="dl-set-section">
        <h2>Типографика</h2>
        <p className="dl-set-section-sub">8 независимых зон: семейство, размер, строка, насыщенность.</p>
        <div style={{ marginTop: 20 }}>
          {TYPOGRAPHY_AREAS.map((area) => {
            const zone = typography[area];
            return (
              <div key={area} className="dl-type-row">
                <span className="dl-type-name">{AREA_LABELS[area]}</span>
                <span
                  className="dl-type-preview"
                  style={{
                    fontFamily: `var(--pw-font-${areaToKebab(area)}-family, ${zone.fontFamily})`,
                    fontSize: `var(--pw-font-${areaToKebab(area)}-size, ${zone.fontSizePx}px)`,
                    lineHeight: `var(--pw-font-${areaToKebab(area)}-line-height, ${zone.lineHeight})`,
                    fontWeight: `var(--pw-font-${areaToKebab(area)}-weight, ${zone.weight})`,
                  }}
                >
                  Поиск по истории диалогов · MiMo v2.6 · npm run test
                </span>
                <span className="dl-type-spec">
                  {zone.fontSizePx}px / {zone.lineHeight} · {zone.weight}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="dl-set-section">
        <h2>Рабочее пространство</h2>
        <p className="dl-set-section-sub">Пути WSL — фикстура Design Lab (реальные данные появляются в приложении D2+).</p>
        <div className="dl-type-row" style={{ marginTop: 16 }}>
          <span className="dl-type-name">Проект</span>
          <span className="dl-type-preview" style={{ fontFamily: 'var(--dl-font-mono)' }}>
            ~/projects/pi-wsl-desktop
          </span>
        </div>
        <div className="dl-type-row">
          <span className="dl-type-name">Сессии Pi</span>
          <span className="dl-type-preview" style={{ fontFamily: 'var(--dl-font-mono)' }}>
            ~/.pi/agent/sessions (read-only)
          </span>
        </div>
      </section>

      <section className="dl-set-section" style={{ paddingBottom: 40 }}>
        <h2>Подключение</h2>
        <p className="dl-set-section-sub">
          {connection ? `${connection.label} · ${connection.detail}` : 'Ubuntu · WSL'}
        </p>
      </section>
        </>
      )}
    </div>
  );
}

function areaToKebab(area: string): string {
  return area.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
