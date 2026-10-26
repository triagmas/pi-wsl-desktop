/**
 * Settings (Issue #21 §5, §9.2–9.4): Внешний вид (5 theme cards + custom
 * editor), Типографика (independent per-area), Рабочее пространство (layout),
 * Подключение WSL (real M0 status/diagnostics). All changes go through the
 * appearance store — Pi data is never touched.
 */
import { useEffect, useRef, useState } from 'react';
import type { DesktopApi } from './api';
import { StatusPanel } from './StatusPanel';
import { SettingsScreen } from './ui/SettingsScreen';
import {
  COLOR_TOKEN_KEYS,
  PRESET_IDS,
  THEME_PRESETS,
  type ThemePresetId,
  type ThemeTokens,
} from '../shared/design/presets';
import {
  TYPOGRAPHY_AREAS,
  type AppearanceSettings,
  type TypographyArea,
} from '../shared/appearance';
import { validateCustomTokens, suggestFix, type ValidationIssue } from './design/customTheme';
import { applyTheme } from './design/applyTheme';
import { applyTypography } from './design/applyTypography';
import type { RendererSnapshot } from './types';

const TOKEN_GROUPS: { title: string; keys: (keyof ThemeTokens)[] }[] = [
  {
    title: 'Фоны и поверхности',
    keys: [
      'windowBackgroundColor',
      'titleBarBackgroundColor',
      'sidebarLeftBackgroundColor',
      'sidebarRightBackgroundColor',
      'statusBarBackgroundColor',
      'surfaceBackgroundColor',
      'elevatedSurfaceBackgroundColor',
      'chatInputBackgroundColor',
      'chatBubbleUserBackgroundColor',
      'chatBubbleAssistantBackgroundColor',
    ],
  },
  {
    title: 'Текст, ссылки, акцент',
    keys: [
      'bodyTextColor',
      'mutedTextColor',
      'linkColor',
      'accentColor',
      'accentHoverColor',
      'accentActiveColor',
      'accentTextColor',
    ],
  },
  {
    title: 'Кнопки',
    keys: [
      'buttonPrimaryBackgroundColor',
      'buttonPrimaryHoverColor',
      'buttonPrimaryActiveColor',
      'buttonPrimaryDisabledColor',
      'buttonPrimaryTextColor',
    ],
  },
  {
    title: 'Поля ввода и фокус',
    keys: [
      'inputBackgroundColor',
      'inputBorderColor',
      'placeholderColor',
      'focusRingColor',
      'selectionBackgroundColor',
      'selectionTextColor',
    ],
  },
  {
    title: 'Границы и состояния',
    keys: ['borderColor', 'dividerColor', 'hoverBackgroundColor', 'selectedBackgroundColor'],
  },
  {
    title: 'Статусы',
    keys: ['warningColor', 'errorColor', 'successColor'],
  },
  {
    title: 'Инструменты',
    keys: ['toolCardBackgroundColor', 'toolCardBorderColor'],
  },
  {
    title: 'Код',
    keys: [
      'codeBackgroundColor',
      'codeForegroundColor',
      'syntaxKeywordColor',
      'syntaxStringColor',
      'syntaxCommentColor',
      'syntaxNumberColor',
      'syntaxFunctionColor',
    ],
  },
  {
    title: 'Терминал',
    keys: [
      'terminalBackgroundColor',
      'terminalForegroundColor',
      'terminalCursorColor',
      'terminalAnsiBlackColor',
      'terminalAnsiRedColor',
      'terminalAnsiGreenColor',
      'terminalAnsiYellowColor',
      'terminalAnsiBlueColor',
      'terminalAnsiMagentaColor',
      'terminalAnsiCyanColor',
      'terminalAnsiWhiteColor',
      'terminalAnsiBrightBlackColor',
      'terminalAnsiBrightRedColor',
      'terminalAnsiBrightGreenColor',
      'terminalAnsiBrightYellowColor',
      'terminalAnsiBrightBlueColor',
      'terminalAnsiBrightMagentaColor',
      'terminalAnsiBrightCyanColor',
      'terminalAnsiBrightWhiteColor',
    ],
  },
];

const TOKEN_LABELS: Partial<Record<keyof ThemeTokens, string>> = {
  windowBackgroundColor: 'Фон окна',
  titleBarBackgroundColor: 'Заголовок окна',
  sidebarLeftBackgroundColor: 'Левая панель',
  sidebarRightBackgroundColor: 'Правая панель',
  statusBarBackgroundColor: 'Статус-бар',
  surfaceBackgroundColor: 'Поверхности',
  elevatedSurfaceBackgroundColor: 'Приподнятые поверхности',
  chatInputBackgroundColor: 'Поле ввода чата',
  chatBubbleUserBackgroundColor: 'Сообщение пользователя',
  chatBubbleAssistantBackgroundColor: 'Ответ Pi',
  bodyTextColor: 'Основной текст',
  mutedTextColor: 'Вторичный текст',
  linkColor: 'Ссылки',
  accentColor: 'Акцент',
  accentHoverColor: 'Акцент (наведение)',
  accentActiveColor: 'Акцент (нажатие)',
  accentTextColor: 'Текст на акценте',
  buttonPrimaryBackgroundColor: 'Основная кнопка',
  buttonPrimaryHoverColor: 'Кнопка (наведение)',
  buttonPrimaryActiveColor: 'Кнопка (нажатие)',
  buttonPrimaryDisabledColor: 'Кнопка (выключена)',
  buttonPrimaryTextColor: 'Текст кнопки',
  inputBackgroundColor: 'Фон поля',
  inputBorderColor: 'Граница поля',
  placeholderColor: 'Подсказка',
  focusRingColor: 'Фокус-кольцо',
  selectionBackgroundColor: 'Выделение',
  selectionTextColor: 'Текст выделения',
  borderColor: 'Границы',
  dividerColor: 'Разделители',
  hoverBackgroundColor: 'Наведение',
  selectedBackgroundColor: 'Выбранное',
  warningColor: 'Предупреждение',
  errorColor: 'Ошибка',
  successColor: 'Успех',
  toolCardBackgroundColor: 'Карточка инструмента',
  toolCardBorderColor: 'Граница карточки',
  codeBackgroundColor: 'Фон кода',
  codeForegroundColor: 'Текст кода',
  syntaxKeywordColor: 'Ключевые слова',
  syntaxStringColor: 'Строки',
  syntaxCommentColor: 'Комментарии',
  syntaxNumberColor: 'Числа',
  syntaxFunctionColor: 'Функции',
  terminalBackgroundColor: 'Фон терминала',
  terminalForegroundColor: 'Текст терминала',
  terminalCursorColor: 'Курсор',
  radiusSmall: 'Радиус (мелкий)',
  radiusMedium: 'Радиус (средний)',
  radiusLarge: 'Радиус (крупный)',
  spacingScale: 'Плотность интервала',
  animationDurationMs: 'Длительность анимации (мс)',
};

export interface LayoutControls {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  onLeftWidth: (w: number) => void;
  onRightWidth: (w: number) => void;
  onToggleLeft: () => void;
  onTerminalHeight: (h: number) => void;
}

export interface SettingsViewProps {
  api: DesktopApi | null;
  appearance: AppearanceSettings;
  ready: boolean;
  onChange: (next: AppearanceSettings) => void;
  onReset: () => void;
  snapshot: RendererSnapshot;
  requestError: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onSelectDistro: (distro: string) => void;
  layout: LayoutControls;
}

export function SettingsView(props: SettingsViewProps) {
  const { appearance, ready, onChange, onReset, layout } = props;

  /* Custom editor state (§9.2): opened only under the fifth card. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTokens, setEditTokens] = useState<ThemeTokens | null>(null);
  const [editName, setEditName] = useState('Моя тема');
  const [editIssues, setEditIssues] = useState<ValidationIssue[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** Tokens the editor was opened with — Reset returns exactly here (review P2). */
  const startTokens = useRef<ThemeTokens | null>(null);
  /** Set right after a successful Apply so the restore effect keeps the new theme. */
  const skipRestore = useRef(false);
  /**
   * Latest persisted appearance for the close-cleanup. The cleanup depends on
   * `editorOpen` ONLY (round-2 review): if it depended on `appearance`, every
   * preset/typography change with the editor open would run the cleanup and
   * roll the document back to the previous snapshot.
   */
  const appearanceRef = useRef(appearance);
  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const startEditor = (base: ThemePresetId): void => {
    // Re-opening the editor must start from the SAVED custom theme when there
    // is one — never silently reset editing to preset-dark (review P2).
    const saved = appearance.theme.preset === 'custom' ? appearance.theme.custom : null;
    const initial = structuredClone(saved ?? THEME_PRESETS[base].tokens);
    startTokens.current = initial;
    setEditTokens(initial);
    setEditName(appearance.theme.preset === 'custom' ? appearance.theme.customName : 'Моя тема');
    setEditIssues([]);
    setEditorOpen(true);
  };

  // Live preview: while editing, the preview applies ONLY to the document
  // theme variables — never to Pi data (§9.2). On cancel/close/unmount the
  // cleanup below re-applies the persisted appearance, because App's layout
  // effect only reacts to CHANGED token references (review P2).
  useEffect(() => {
    if (editorOpen && editTokens) {
      const previewRoot = document.documentElement;
      applyTheme(previewRoot, editTokens);
    }
  }, [editorOpen, editTokens]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    return () => {
      if (skipRestore.current) {
        skipRestore.current = false;
        return; // Apply already stored the new theme — App re-applies it.
      }
      const a = appearanceRef.current; // CURRENT persisted state at close/unmount
      const persisted =
        a.theme.preset === 'custom'
          ? (a.theme.custom ?? THEME_PRESETS.dark.tokens)
          : THEME_PRESETS[a.theme.preset].tokens;
      applyTheme(document.documentElement, persisted);
      applyTypography(document.documentElement, a.typography);
    };
  }, [editorOpen]);

  const validate = (tokens: ThemeTokens): boolean => {
    const result = validateCustomTokens(tokens);
    setEditIssues(result.issues);
    return result.ok;
  };

  const applyCustom = (): void => {
    if (!editTokens) return;
    if (!validate(editTokens)) return; // fail-safe: reject invalid contrast/hex
    onChange({
      ...appearance,
      theme: { preset: 'custom', customName: editName.trim() || 'Моя тема', custom: editTokens },
    });
    skipRestore.current = true; // the NEW theme must survive the close cleanup
    setSavedAt(new Date().toLocaleTimeString());
    setEditorOpen(false);
  };

  const cancelEditor = (): void => {
    setEditTokens(null);
    setEditIssues([]);
    setEditorOpen(false);
    // The close-cleanup restores the document theme; this call only ensures
    // App observes the same persisted appearance object (no settings change).
    onChange({ ...appearance });
  };

  const resetEditor = (): void => {
    if (!startTokens.current) return;
    setEditTokens(structuredClone(startTokens.current));
    setEditIssues([]);
  };

  return (
    <SettingsScreen testid="settings-root">
      <section className="dl-set-section" data-testid="settings-appearance">
        <h2>Внешний вид</h2>
        <p className="dl-set-section-sub">
            Тема меняет только оформление — сессии, потоки и настройки Pi не затрагиваются.
            {!ready && ' Загрузка…'}
          </p>
          <div className="dl-theme-grid" role="radiogroup" aria-label="Темы">
            {PRESET_IDS.map((id) => {
              const preset = THEME_PRESETS[id];
              const active = appearance.theme.preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  data-testid={`theme-card-${id}`}
                  aria-checked={active}
                  className={`dl-theme-card${active ? ' dl-theme-card-active' : ''}`}
                  onClick={() => onChange({ ...appearance, theme: { ...appearance.theme, preset: id } })}
                >
                  <span style={{ fontWeight: 600 }}>{preset.label}</span>
                  <span className="dl-theme-swatches" aria-hidden="true">
                    <span className="dl-theme-swatch" style={{ background: preset.tokens.windowBackgroundColor }} />
                    <span className="dl-theme-swatch" style={{ background: preset.tokens.sidebarLeftBackgroundColor }} />
                    <span className="dl-theme-swatch" style={{ background: preset.tokens.accentColor }} />
                    <span className="dl-theme-swatch" style={{ background: preset.tokens.bodyTextColor }} />
                  </span>
                  {preset.attribution && <span className="dl-theme-card-note muted">inspired-by</span>}
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              data-testid="theme-card-custom"
              aria-checked={appearance.theme.preset === 'custom'}
              className={`dl-theme-card${appearance.theme.preset === 'custom' ? ' dl-theme-card-active' : ''}`}
              onClick={() => {
                if (!editorOpen) startEditor('dark');
                else setEditorOpen((v) => v);
              }}
            >
              <span style={{ fontWeight: 600 }}>Своя тема</span>
              <span className="dl-theme-swatches" aria-hidden="true">
                <span className="dl-theme-swatch" style={{ background: appearance.theme.custom?.windowBackgroundColor ?? '#20221F' }} />
                <span className="dl-theme-swatch" style={{ background: appearance.theme.custom?.sidebarLeftBackgroundColor ?? '#191C19' }} />
                <span className="dl-theme-swatch" style={{ background: appearance.theme.custom?.accentColor ?? '#78957C' }} />
                <span className="dl-theme-swatch" style={{ background: appearance.theme.custom?.bodyTextColor ?? '#E7EAE3' }} />
              </span>
              <span className="dl-theme-card-note muted">{appearance.theme.customName}</span>
            </button>
          </div>

          {editorOpen && editTokens && (
            <div className="theme-editor" data-testid="theme-editor">
              <div className="theme-editor-head">
                <h2>Редактор своей темы</h2>
                <label className="field-inline">
                  Название
                  <input
                    data-testid="theme-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={60}
                  />
                </label>
                <label className="field-inline">
                  Основа
                  <select
                    data-testid="theme-base"
                    defaultValue="dark"
                    onChange={(e) => {
                      const base = e.target.value as ThemePresetId;
                      setEditTokens(structuredClone(THEME_PRESETS[base].tokens));
                      setEditIssues([]);
                    }}
                  >
                    {PRESET_IDS.map((id) => (
                      <option key={id} value={id}>
                        {THEME_PRESETS[id].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {editIssues.length > 0 && (
                <div className="editor-issues" role="alert" data-testid="theme-issues">
                  <strong>Тема не будет сохранена:</strong>
                  <ul>
                    {editIssues.map((issue) => (
                      <li key={`${issue.key}-${issue.kind}`}>
                        {TOKEN_LABELS[issue.key] ?? issue.key}: {issue.message}{' '}
                        {issue.kind === 'contrast' && (
                          <button
                            type="button"
                            data-testid={`fix-${String(issue.key)}`}
                            onClick={() => {
                              const fix = suggestFix(issue);
                              if (fix && editTokens) {
                                const next = { ...editTokens, [issue.key]: fix };
                                setEditTokens(next);
                                validate(next);
                              }
                            }}
                          >
                            Исправить
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="editor-groups">
                {TOKEN_GROUPS.map((group) => (
                  <fieldset key={group.title} className="editor-group">
                    <legend>{group.title}</legend>
                    {group.keys.map((key) => (
                      <label key={key} className="editor-field">
                        <span>{TOKEN_LABELS[key] ?? key}</span>
                        <input
                          type="color"
                          data-testid={`token-${key}`}
                          value={String(editTokens[key])}
                          onChange={(e) => {
                            const next = { ...editTokens, [key]: e.target.value };
                            setEditTokens(next);
                          }}
                          onBlur={() => validate(editTokens)}
                        />
                      </label>
                    ))}
                  </fieldset>
                ))}
                <fieldset className="editor-group">
                  <legend>Радиусы и ритм</legend>
                  {(['radiusSmall', 'radiusMedium', 'radiusLarge'] as const).map((key) => (
                    <label key={key} className="editor-field">
                      <span>{TOKEN_LABELS[key]}</span>
                      <input
                        data-testid={`token-${key}`}
                        value={String(editTokens[key])}
                        onChange={(e) => setEditTokens({ ...editTokens, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                  <label className="editor-field">
                    <span>{TOKEN_LABELS.spacingScale}</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.75"
                      max="1.5"
                      data-testid="token-spacingScale"
                      value={String(editTokens.spacingScale)}
                      onChange={(e) =>
                        setEditTokens({ ...editTokens, spacingScale: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="editor-field">
                    <span>{TOKEN_LABELS.animationDurationMs}</span>
                    <input
                      type="number"
                      step="20"
                      min="0"
                      max="1000"
                      data-testid="token-animationDurationMs"
                      value={String(editTokens.animationDurationMs)}
                      onChange={(e) =>
                        setEditTokens({ ...editTokens, animationDurationMs: Number(e.target.value) })
                      }
                    />
                  </label>
                </fieldset>
              </div>

              <div className="theme-editor-preview" data-testid="theme-preview">
                <span className="preview-chip" style={{ background: editTokens.accentColor, color: editTokens.accentTextColor }}>
                  Акцент
                </span>
                <span className="preview-chip" style={{ background: editTokens.surfaceBackgroundColor, color: editTokens.bodyTextColor }}>
                  Текст
                </span>
                <span className="preview-chip" style={{ background: editTokens.errorColor, color: '#ffffff' }}>
                  Ошибка
                </span>
                <span className="preview-chip" style={{ background: editTokens.codeBackgroundColor, color: editTokens.codeForegroundColor, fontFamily: 'monospace' }}>
                  {'code()'}
                </span>
              </div>

              <div className="theme-editor-actions">
                <button type="button" className="btn-primary" data-testid="theme-apply" onClick={applyCustom}>
                  Apply
                </button>
                <button type="button" data-testid="theme-cancel" onClick={cancelEditor}>
                  Cancel
                </button>
                <button type="button" data-testid="theme-reset" onClick={resetEditor}>
                  Reset
                </button>
                <button type="button" data-testid="settings-reset" onClick={onReset}>
                  Сбросить все настройки
                </button>
                {savedAt && (
                  <span className="muted" data-testid="theme-saved">
                    Сохранено в {savedAt}
                  </span>
                )}
              </div>
            </div>
          )}

          {appearance.theme.preset === 'custom' && !editorOpen && (
            <div className="custom-summary" data-testid="custom-summary">
              <span>Активна своя тема «{appearance.theme.customName}».</span>
              <button type="button" data-testid="custom-edit" onClick={() => startEditor('dark')}>
                Редактировать
              </button>
            </div>
          )}
          <div className="card-group-note muted">{COLOR_TOKEN_KEYS.length} семантических цветов · 4 пресета + своя</div>
      </section>

      <section className="dl-set-section" data-testid="settings-typography">
        <h2>Типографика</h2>
        <p className="dl-set-section-sub">
            Шрифты задаются для каждой области отдельно и не сбрасываются при смене темы.
          </p>
          {TYPOGRAPHY_AREAS.map((area) => (
            <TypoRow
              key={area}
              area={area}
              zone={appearance.typography[area]}
              onChange={(zone) =>
                onChange({
                  ...appearance,
                  typography: { ...appearance.typography, [area]: zone },
                })
              }
            />
          ))}
      </section>

      <section className="dl-set-section" data-testid="settings-workspace">
        <h2>Рабочее пространство</h2>
          <label className="dl-type-row">
            <span className="dl-type-name">Ширина левой панели</span>
            <input
              type="range"
              min={200}
              max={480}
              step={10}
              data-testid="left-width"
              value={layout.leftWidth}
              onChange={(e) => layout.onLeftWidth(Number(e.target.value))}
            />
            <span className="dl-type-spec dl-type-spec-auto">{layout.leftWidth}px</span>
          </label>
          <label className="dl-type-row">
            <span className="dl-type-name">Ширина панели деталей</span>
            <input
              type="range"
              min={240}
              max={560}
              step={10}
              data-testid="right-width"
              value={layout.rightWidth}
              onChange={(e) => layout.onRightWidth(Number(e.target.value))}
            />
            <span className="dl-type-spec dl-type-spec-auto">{layout.rightWidth}px</span>
          </label>
          <label className="dl-type-row">
            <span className="dl-type-name">Высота слота терминала</span>
            <input
              type="range"
              min={120}
              max={600}
              step={20}
              data-testid="terminal-height"
              value={appearance.layout.terminalSlotHeight}
              onChange={(e) => layout.onTerminalHeight(Number(e.target.value))}
            />
            <span className="dl-type-spec dl-type-spec-auto">{appearance.layout.terminalSlotHeight}px</span>
          </label>
          <label className="dl-type-row">
            <span className="dl-type-name">Сворачивать левую панель</span>
            <input
              type="checkbox"
              data-testid="left-collapsed"
              checked={layout.leftCollapsed}
              onChange={layout.onToggleLeft}
            />
          </label>
          <p className="muted">
            Состояние и размеры сохраняются; автоподстройка при узком окне сохранённые значения не
            перезаписывает.
          </p>
      </section>

      <section className="dl-set-section" data-testid="settings-connection">
        <h2>Подключение</h2>
          <StatusPanel
            snapshot={props.snapshot}
            requestError={props.requestError}
            api={props.api}
            onRetry={props.onRetry}
            onRefresh={props.onRefresh}
            onSelectDistro={props.onSelectDistro}
          />
      </section>
    </SettingsScreen>
  );
}

function TypoRow({
  area,
  zone,
  onChange,
}: {
  area: TypographyArea;
  zone: AppearanceSettings['typography'][TypographyArea];
  onChange: (zone: AppearanceSettings['typography'][TypographyArea]) => void;
}) {
  const labels: Record<TypographyArea, string> = {
    ui: 'Общий интерфейс',
    sidebar: 'Список проектов и чатов',
    chatInput: 'Ввод чата',
    chatResponse: 'Ответы Pi',
    code: 'Код (fenced и inline)',
    toolOutput: 'Вывод инструментов',
    terminal: 'Терминал',
    statusBar: 'Статус-бар',
  };
  const isMonoArea = area === 'code' || area === 'toolOutput' || area === 'terminal';
  return (
    <fieldset className="dl-type-group" aria-label={labels[area]}>
      <div className="dl-type-row" data-testid={`typo-${area}`}>
        <span className="dl-type-name">{labels[area]}</span>
        <span className="dl-type-fields">
      <label className="field-inline">
        Семейство
        <input
          data-testid={`${area}-family`}
          value={zone.fontFamily}
          onChange={(e) => onChange({ ...zone, fontFamily: e.target.value })}
          list={`fonts-${area}`}
        />
        <datalist id={`fonts-${area}`}>
          <option value={'"Segoe UI", system-ui, sans-serif'} />
          <option value={'"Cascadia Mono", Consolas, monospace'} />
          <option value={'Consolas, "Liberation Mono", monospace'} />
          <option value={'"Segoe UI", Tahoma, sans-serif'} />
          {isMonoArea && <option value={'"Courier New", monospace'} />}
        </datalist>
      </label>
      <label className="field-inline">
        px
        <input
          type="number"
          min={8}
          max={40}
          data-testid={`${area}-size`}
          value={zone.fontSizePx}
          onChange={(e) => onChange({ ...zone, fontSizePx: Number(e.target.value) })}
        />
      </label>
      <label className="field-inline">
        Строка
        <input
          type="number"
          step={0.05}
          min={1}
          max={3}
          data-testid={`${area}-line-height`}
          value={zone.lineHeight}
          onChange={(e) => onChange({ ...zone, lineHeight: Number(e.target.value) })}
        />
      </label>
      <label className="field-inline">
        Насыщенность
        <select
          data-testid={`${area}-weight`}
          value={zone.weight}
          onChange={(e) => onChange({ ...zone, weight: Number(e.target.value) })}
        >
          {[300, 400, 500, 600, 700].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      </span>
        <span
          className="dl-type-preview"
          data-testid={`${area}-preview`}
          style={{
            fontFamily: zone.fontFamily,
            fontSize: `${zone.fontSizePx}px`,
            lineHeight: String(zone.lineHeight),
            fontWeight: String(zone.weight),
          }}
        >
          Поиск по истории диалогов · MiMo v2.6 · npm run test
        </span>
        <span className="dl-type-spec dl-type-spec-auto">
          {zone.fontSizePx}px / {zone.lineHeight} · {zone.weight}
        </span>
      </div>
    </fieldset>
  );
}
