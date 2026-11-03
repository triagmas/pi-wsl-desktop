/**
 * Settings (Issue #21 §5, §9.2–§9.4; UI Integration V1).
 *
 * Скелет страницы — общий с Design Lab (`src/renderer/design/settings-page.css`):
 * колонка 760 px, отступы 24, зазоры разделов 24 / групп 12.
 *
 * Тема: 5 светлых / 4 тёмных палитры; у каждой карточки четыре образца в порядке
 * «область → обе панели → акцент → текст»; «своя» тема редактируется ровно
 * четырьмя полями, одно из которых задаёт обе боковые панели. Светлая и тёмная
 * палитры хранятся независимо. Контраст считается по 19 парам (AA 4.5:1) и
 * блокирует «Применить» при провале.
 *
 * Типографика: один неизменяемый системный шрифт + два настраиваемых слота
 * (ответы и код). Ширины панелей и высота терминала здесь не настраиваются —
 * они живут в раскладке и меняются перетаскиванием.
 *
 * Все изменения уходят в appearance-store (IPC). Pi-данные не затрагиваются.
 */
import { useLayoutEffect, useMemo, useState } from 'react';
import type { RendererSnapshot } from './types';
import { phaseText } from './StatusPanel';
import {
  DEFAULT_APPEARANCE,
  appearanceThemeTokens,
  type AppearanceSettings,
  type TypographyArea,
} from '../shared/appearance';
import {
  resolveThemeTokens,
  type ThemeMode,
  type ThemePresetId,
} from '../shared/design/presets';
import {
  FONT_CHOICES,
  FONT_SLOT_AREAS,
  FONT_SLOT_LABELS,
  FONT_SLOT_ORDER,
  PALETTES_BY_MODE,
  SYSTEM_FONT_STACK,
  fontIdFromStack,
  fontStackById,
  type FontSlot,
  type PaletteSeed,
} from '../shared/design/palettes';
import { contrastRatio } from '../shared/design/contrast';
import { validateCustomTokens } from './design/customTheme';
import { applyTheme } from './design/applyTheme';
import { applyTypography } from './design/applyTypography';

const HEX = /^#[0-9a-fA-F]{6}$/;

const REPLY_SAMPLE =
  'Ответ Pi: поиск по истории диалогов снова работает.\n' +
  'Les accents français — déjà, garçon, naïve, cœur, Noël.\n' +
  'English sample: the quick brown fox jumps over the lazy dog.';

const CODE_SAMPLE =
  'const sessions = all.filter((s) => s.title.includes(query));\n' +
  '// Поиск: «Открыть проект» — кириллица, accents: déjà vu, Noël\n' +
  'npm run test -- --run tests/ui/sessionSearch.ts';

/**
 * R03-2 (#26, #6572954720, P3) — предпросмотр на одну ступень НИЖЕ рабочего
 * размера: он показывает характер шрифта, а не конкурирует с рабочим текстом.
 * Фактические настройки пользователя (`font-reply-size` и т.п.) не меняются —
 * уменьшается только образец, стоящий рядом с контролом.
 */
/** Системный шрифт неизменяем (B1 R06 r01) — его размер также фиксирован. */
const SYSTEM_FONT_SIZE = 13;
const PREVIEW_STEP_PX = 1;
const PREVIEW_MIN_PX = 11;

export function previewFontSize(actualPx: number): number {
  return Math.max(PREVIEW_MIN_PX, actualPx - PREVIEW_STEP_PX);
}

const SYSTEM_SAMPLE = 'Панели, меню и поле ввода чата · Session list\nProjet déjà ouvert · Noël · кириллица';

const COLOR_FIELDS: { key: keyof PaletteSeed; label: string; hint: string; testid: string }[] = [
  { key: 'window', label: 'Рабочая область', hint: 'фон окна и центральной области', testid: 'custom-workspace' },
  { key: 'panel', label: 'Боковые панели', hint: 'одно поле задаёт левую и правую панели', testid: 'custom-panels' },
  { key: 'accent', label: 'Акцент', hint: 'кнопки, ссылки, фокус, выделение', testid: 'custom-accent' },
  { key: 'text', label: 'Основной текст', hint: 'не переопределяется автоматически', testid: 'custom-text' },
];

interface ThemeDraft {
  mode: ThemeMode;
  preset: Record<ThemeMode, ThemePresetId>;
  custom: Record<ThemeMode, PaletteSeed>;
}

interface Draft {
  theme: ThemeDraft;
  typography: AppearanceSettings['typography'];
}

function draftFrom(appearance: AppearanceSettings): Draft {
  return {
    theme: structuredClone(appearance.theme),
    typography: structuredClone(appearance.typography),
  };
}

export interface SettingsViewProps {
  appearance: AppearanceSettings;
  ready: boolean;
  onChange: (next: AppearanceSettings) => void;
  snapshot: RendererSnapshot;
  requestError: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onSelectDistro: (distro: string) => void;
}

export function SettingsView({
  appearance,
  ready,
  onChange,
  snapshot,
  requestError,
  onRetry,
  onRefresh,
  onSelectDistro,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(appearance));
  const [draftSource, setDraftSource] = useState(appearance);

  // Внешние изменения (применение, сброс, другой экран) синхронизируют черновик.
  // Корректировка состояния во время рендера — рекомендованный React-паттерн:
  // без эффекта, без каскадного рендера после коммита.
  if (draftSource !== appearance) {
    setDraftSource(appearance);
    setDraft(draftFrom(appearance));
  }

  const paletteId = draft.theme.preset[draft.theme.mode];
  const palettes = PALETTES_BY_MODE[draft.theme.mode];
  const isCustom = paletteId === (draft.theme.mode === 'light' ? 'customLight' : 'customDark');
  const seed = draft.theme.custom[draft.theme.mode];

  const tokens = useMemo(
    () => resolveThemeTokens(paletteId, draft.theme.mode, draft.theme.custom),
    [paletteId, draft.theme.mode, draft.theme.custom],
  );
  const validation = useMemo(() => validateCustomTokens(tokens), [tokens]);

  const textOnWindow = contrastRatio(seed.text, seed.window);
  const textOnPanel = contrastRatio(seed.text, seed.panel);
  const accentOnWindow = contrastRatio(seed.accent, seed.window);

  const dirty =
    JSON.stringify(draft.theme) !== JSON.stringify(appearance.theme) ||
    JSON.stringify(draft.typography) !== JSON.stringify(appearance.typography);

  // Живой предпросмотр: черновик применяется к документу, при отмене/уходе
  // возвращаются сохранённые значения.
  useLayoutEffect(() => {
    if (!ready) return undefined;
    applyTheme(document.documentElement, resolveThemeTokens(
      draft.theme.preset[draft.theme.mode],
      draft.theme.mode,
      draft.theme.custom,
    ));
    applyTypography(document.documentElement, draft.typography);
    return () => {
      applyTheme(document.documentElement, appearanceThemeTokens(appearance.theme));
      applyTypography(document.documentElement, appearance.typography);
    };
  }, [draft, ready, appearance]);

  const setMode = (mode: ThemeMode) => setDraft((prev) => ({ ...prev, theme: { ...prev.theme, mode } }));

  const setPreset = (id: ThemePresetId) =>
    setDraft((prev) => ({
      ...prev,
      theme: {
        ...prev.theme,
        preset: { ...prev.theme.preset, [prev.theme.mode]: id },
      },
    }));

  const setColor = (key: keyof PaletteSeed, value: string) => {
    const next = value.toUpperCase();
    if (!HEX.test(next)) return;
    setDraft((prev) => ({
      ...prev,
      theme: {
        ...prev.theme,
        custom: {
          ...prev.theme.custom,
          [prev.theme.mode]: { ...prev.theme.custom[prev.theme.mode], [key]: next },
        },
      },
    }));
  };

  const setFont = (slot: FontSlot, fontId: string) =>
    setDraft((prev) => {
      const stack = fontStackById(fontId);
      const typography = { ...prev.typography };
      for (const area of FONT_SLOT_AREAS[slot]) {
        typography[area as TypographyArea] = { ...typography[area as TypographyArea], fontFamily: stack };
      }
      return { ...prev, typography };
    });

  const setFontSize = (slot: FontSlot, size: number) => {
    const clamped = Math.min(22, Math.max(10, Math.round(size)));
    setDraft((prev) => {
      const typography = { ...prev.typography };
      for (const area of FONT_SLOT_AREAS[slot]) {
        typography[area as TypographyArea] = { ...typography[area as TypographyArea], fontSizePx: clamped };
      }
      return { ...prev, typography };
    });
  };

  const apply = () => {
    if (!ready || !dirty || !validation.ok) return;
    onChange({ ...appearance, theme: structuredClone(draft.theme), typography: structuredClone(draft.typography) });
  };

  const cancel = () => setDraft(draftFrom(appearance));

  const reset = () =>
    setDraft({
      theme: structuredClone(DEFAULT_APPEARANCE.theme),
      typography: structuredClone(DEFAULT_APPEARANCE.typography),
    });

  const replyFontId = fontIdFromStack(draft.typography.chatResponse.fontFamily);
  const codeFontId = fontIdFromStack(draft.typography.code.fontFamily);
  const replySize = draft.typography.chatResponse.fontSizePx;
  const codeSize = draft.typography.code.fontSizePx;
  const replyStack = draft.typography.chatResponse.fontFamily;
  const codeStack = draft.typography.code.fontFamily;

  return (
    <div className="dl2-screen" data-testid="settings-root">
      <div className="dl2-col" data-testid="settings-col">
        <header className="dl2-head">
          <h1 className="dl2-h1">Настройки</h1>
          <p className="dl2-page-sub">Внешний вид, типографика и подключение Pi в WSL.</p>
        </header>

        <section className="dl2-section" data-testid="settings-appearance">
          <div className="dl2-section-head">
            <h2 className="dl2-h2">Внешний вид</h2>
            <p className="dl2-section-desc">
              Светлые и тёмные варианты выбираются отдельно. На карточке четыре цвета: рабочая область, обе боковые
              панели, акцент и основной текст.
            </p>
          </div>

          <div className="dl2-group">
            <div className="dl2-seg" role="radiogroup" aria-label="Режим темы">
              {(['light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={draft.theme.mode === mode}
                  className={`dl2-seg-btn${draft.theme.mode === mode ? ' is-active' : ''}`}
                  data-testid={`theme-mode-${mode}`}
                  onClick={() => setMode(mode)}
                >
                  {mode === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>

            <div className="dl2-presets" role="radiogroup" aria-label="Варианты темы">
              {palettes.map((palette) => {
                const active = paletteId === palette.id;
                const paletteSeed = palette.custom ? draft.theme.custom[draft.theme.mode] : palette.seed;
                const testid = palette.custom ? 'theme-card-custom' : `theme-card-${palette.id}`;
                return (
                  <button
                    key={palette.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`dl2-preset${active ? ' is-active' : ''}${palette.custom ? ' is-custom' : ''}`}
                    data-testid={testid}
                    data-preset={palette.id}
                    onClick={() => setPreset(palette.id as ThemePresetId)}
                  >
                    <span className="dl2-preset-name">{palette.label}</span>
                    <span className="dl2-swatches" aria-hidden="true" data-testid={`swatches-${palette.id}`}>
                      <span className="dl2-swatch" data-swatch="workspace" style={{ background: paletteSeed.window }} />
                      <span className="dl2-swatch" data-swatch="panels" style={{ background: paletteSeed.panel }} />
                      <span className="dl2-swatch" data-swatch="accent" style={{ background: paletteSeed.accent }} />
                      <span className="dl2-swatch" data-swatch="text" style={{ background: paletteSeed.text }} />
                    </span>
                    {palette.custom ? <span className="dl2-preset-note">4 цвета</span> : null}
                  </button>
                );
              })}
            </div>

            {isCustom ? (
              <div className="dl2-card dl2-editor" data-testid="theme-editor">
                {COLOR_FIELDS.map((field) => (
                  <div className="dl2-color-row" key={field.key}>
                    <span className="dl2-row-label">{field.label}</span>
                    <input
                      type="color"
                      className="dl2-color"
                      data-testid={field.testid}
                      value={seed[field.key]}
                      onChange={(e) => setColor(field.key, e.target.value)}
                    />
                    <span className="dl2-hex">{seed[field.key]}</span>
                    <span className="dl2-color-hint">{field.hint}</span>
                  </div>
                ))}
                <div className="dl2-status" data-ok={validation.ok ? 'true' : 'false'} data-testid="custom-contrast-status">
                  {validation.ok ? '✓' : '!'} Контраст: текст/область {textOnWindow.toFixed(2)}:1 · текст/панели{' '}
                  {textOnPanel.toFixed(2)}:1 · акцент/область {accentOnWindow.toFixed(2)}:1
                  {validation.ok ? '' : ` · пар ниже AA: ${validation.issues.filter((i) => i.kind === 'contrast').length}`}
                </div>
              </div>
            ) : (
              <p className="dl2-section-desc" data-testid="theme-preset-note">
                Цвета готового варианта не редактируются: выберите «Свою», чтобы открыть четыре поля.
              </p>
            )}
          </div>
        </section>

        <section className="dl2-section" data-testid="settings-typography">
          <div className="dl2-section-head">
            <h2 className="dl2-h2">Типографика</h2>
            <p className="dl2-section-desc">
              Интерфейс использует один системный шрифт. Настраиваются только шрифт ответов и шрифт кода.
            </p>
          </div>

          <div className="dl2-group">
            <div className="dl2-font-block is-system" data-testid="font-block-system">
              <div className="dl2-font-head">
                <span className="dl2-font-title">Системный шрифт</span>
                <span className="dl2-font-hint">меню, панели, ввод чата, статус</span>
                <span className="dl2-tag">не изменяется</span>
              </div>
              <span className="dl2-fixed" data-testid="font-system-value">
                Segoe UI · {SYSTEM_FONT_SIZE} px
              </span>
              <div
                className="dl2-preview"
                data-testid="preview-system"
                style={{ fontFamily: SYSTEM_FONT_STACK, fontSize: previewFontSize(SYSTEM_FONT_SIZE) }}
              >
                {SYSTEM_SAMPLE}
              </div>
            </div>

            {FONT_SLOT_ORDER.map((slot) => {
              const family = slot === 'reply' ? replyStack : codeStack;
              const size = slot === 'reply' ? replySize : codeSize;
              const fontId = slot === 'reply' ? replyFontId : codeFontId;
              return (
                <div className="dl2-font-block" data-testid={`font-block-${slot}`} key={slot}>
                  <div className="dl2-font-head">
                    <span className="dl2-font-title">{FONT_SLOT_LABELS[slot]}</span>
                    <span className="dl2-font-hint">
                      {slot === 'reply' ? 'только текст ответов Pi, не поле ввода' : 'код, инструменты и терминал'}
                    </span>
                  </div>
                  <div className="dl2-font-controls">
                    <select
                      className="dl2-select"
                      data-testid={`font-${slot}-family`}
                      aria-label={FONT_SLOT_LABELS[slot]}
                      value={fontId}
                      onChange={(e) => setFont(slot, e.target.value)}
                    >
                      {FONT_CHOICES.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="dl2-input"
                      type="number"
                      min={10}
                      max={22}
                      step={1}
                      aria-label={`${FONT_SLOT_LABELS[slot]}: размер`}
                      data-testid={`font-${slot}-size`}
                      value={size}
                      onChange={(e) => setFontSize(slot, Number(e.target.value))}
                    />
                  </div>
                  <div
                    className={`dl2-preview is-${slot}`}
                    data-testid={`preview-${slot}`}
                    style={{ fontFamily: family, fontSize: previewFontSize(size) }}
                  >
                    {slot === 'reply' ? REPLY_SAMPLE : CODE_SAMPLE}
                  </div>
                </div>
              );
            })}
            <p className="dl2-section-desc">
              Закрытый список: Consolas, Courier New, Lucida Console — проверены на кириллицу, французские диакритики и
              латиницу. Свободный ввод семейства отключён.
            </p>
          </div>
        </section>

        <section className="dl2-section" data-testid="settings-connection">
          <div className="dl2-section-head">
            <h2 className="dl2-h2">Подключение</h2>
            <p className="dl2-section-desc">Состояние моста Pi и дистрибутива WSL.</p>
          </div>
          <div className="dl2-card">
            <div className="dl2-conn">
              <div className="dl2-conn-row">
                <span className="dl2-conn-key">Статус</span>
                <span>
                  <span
                    className="dl2-dot"
                    aria-hidden="true"
                    data-state={snapshot.phase}
                    style={{ background: snapshot.phase === 'ready' ? 'var(--pw-success-color)' : 'var(--pw-warning-color)' }}
                  />
                  <span data-testid="status-phase">{phaseText(snapshot)}</span>
                </span>
              </div>
              <div className="dl2-conn-row" data-testid="settings-distro-row">
                <span className="dl2-conn-key">Дистрибутив</span>
                {snapshot.distros && snapshot.distros.length > 0 ? (
                  <select
                    className="dl2-select"
                    data-testid="distro"
                    aria-label="Дистрибутив WSL"
                    value={snapshot.distro ?? snapshot.distros[0] ?? ''}
                    onChange={(e) => onSelectDistro(e.target.value)}
                  >
                    {snapshot.distros.map((distro) => (
                      <option key={distro} value={distro}>
                        {distro}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span data-testid="status-distro">{snapshot.distro ?? '—'}</span>
                )}
              </div>
              <div className="dl2-conn-row">
                <span className="dl2-conn-key">Pi</span>
                <span data-testid="runtime-pi">
                  {snapshot.runtime?.pi.version ? `версия ${snapshot.runtime.pi.version}` : '—'}
                  {snapshot.runtime && !snapshot.runtime.pi.rpcSupported ? ' · RPC не поддерживается' : ''}
                </span>
              </div>
              <div className="dl2-conn-row">
                <span className="dl2-conn-key">Node.js</span>
                <span data-testid="runtime-node">{snapshot.runtime?.node.version ?? '—'}</span>
              </div>
              {requestError ? (
                <div className="dl2-status" data-ok="false" role="alert" data-testid="settings-request-error">
                  ! {requestError}
                </div>
              ) : null}
            </div>
            <div className="dl2-actions">
              <button type="button" className="dl-btn-ghost" data-testid="settings-refresh" onClick={onRefresh}>
                Обновить состояние
              </button>
              <button type="button" className="dl-btn-ghost" data-testid="settings-retry" onClick={onRetry}>
                Переподключиться
              </button>
            </div>
          </div>
        </section>

        <div className="dl2-actions dl2-actions-sticky" data-testid="settings-actions">
          <button
            type="button"
            className="dl-btn-primary"
            data-testid="theme-apply"
            onClick={apply}
            disabled={!ready || !dirty || !validation.ok}
          >
            <span>Применить</span>
          </button>
          <button type="button" className="dl-btn-ghost" data-testid="theme-cancel" onClick={cancel} disabled={!dirty}>
            Отмена
          </button>
          <button type="button" className="dl-btn-ghost" data-testid="theme-reset" onClick={reset}>
            Сбросить
          </button>
          <span className="dl2-color-hint" data-testid="settings-state">
            {dirty ? 'есть неприменённые изменения' : 'применено'}
          </span>
        </div>
      </div>
    </div>
  );
}

