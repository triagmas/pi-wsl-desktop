/**
 * Design Lab — страница «Компоненты» (Issue #21 / D1-b, эталон Reference/component-board.png).
 *
 * Интерактивный учебный лист дизайн-системы: 9 ячеек 01–09, все элементы живые —
 * вкладки переключаются, поля поиска вводят текст, пилюли/кнопки нажимаются,
 * селектор модели и пресеты тем выбираются. Глобальные контролы страницы:
 * пресет темы (applyTheme, иммутабельные токены), семейство шрифта и фактор кегля
 * (applyTypography, зона ui). Только fixture/представление: без Electron, Pi,
 * WSL, IPC и user ~/.pi.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  defaultTypography,
  TYPOGRAPHY_AREAS,
  type TypographyArea,
} from '../../shared/appearance';
import { PRESET_IDS, THEME_PRESETS, type ThemePresetId, type ThemeTokens } from '../../shared/design/presets';
import { applyTheme } from '../design/applyTheme';
import { applyTypography } from '../design/applyTypography';
import { hexColor, meetsAA } from '../../shared/design/contrast';
import { ChatView, type ChatTurn } from './ChatView';
import { DetailsPanel } from './DetailsPanel';
import { Rail } from './Rail';
import { StatusBar } from './StatusBar';
import { TerminalPane } from './TerminalPane';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDots,
  IconFileDoc,
  IconFolder,
  IconPanelExpand,
  IconPlus,
  IconSearch,
  IconTerminalGlyph,
} from './icons';

type PresetId = ThemePresetId | 'custom';

/** Токены «Своей темы»: правый ползунок акцента, остальное — DARK. */
const CUSTOM_BASE: ThemeTokens = { ...THEME_PRESETS.dark.tokens };

const CUSTOM_LABELS: Record<PresetId, string> = {
  dark: 'Тёмная',
  light: 'Светлая',
  claude: 'Claude',
  codex: 'Codex',
  custom: 'Своя тема',
};

const FONT_FAMILIES: { id: string; label: string; value: string }[] = [
  { id: 'segoe', label: 'Segoe UI', value: '"Segoe UI", system-ui, sans-serif' },
  { id: 'system', label: 'System UI', value: 'system-ui, sans-serif' },
  { id: 'serif', label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Cascadia Mono', value: '"Cascadia Mono", Consolas, ui-monospace, monospace' },
];

const TYPE_AREA_LABELS: Record<TypographyArea, string> = {
  ui: 'Интерфейс',
  sidebar: 'Боковая панель',
  chatInput: 'Поле ввода',
  chatResponse: 'Ответы Pi',
  code: 'Код',
  toolOutput: 'Вывод инструментов',
  terminal: 'Терминал',
  statusBar: 'Статус-бар',
};

const DEFAULT_TYPE = defaultTypography();

const BOARD_CELLS: { id: string; n: string; title: string; sub: string }[] = [
  { id: 'nav', n: '01', title: 'Навигация', sub: 'Боковая панель (развернутая) и свернутая' },
  { id: 'buttons', n: '02', title: 'Кнопки', sub: 'Состояния одной иконной кнопки и варианты панели' },
  { id: 'tabs', n: '03', title: 'Вкладки и поиск', sub: 'Вкладки в верхней панели и поле поиска по истории' },
  { id: 'dialog', n: '04', title: 'Диалог', sub: 'Сообщение пользователя и ответ ассистента Pi' },
  { id: 'actions', n: '05', title: 'Действия Pi', sub: 'Инструменты и этапы выполнения' },
  { id: 'composer', n: '06', title: 'Поле ввода', sub: 'Компонент ввода сообщения' },
  { id: 'right', n: '07', title: 'Правая панель', sub: 'Детали действия, вкладки и список файлов' },
  { id: 'terminal', n: '08', title: 'Терминал', sub: 'Вкладки терминала и вывод' },
  { id: 'status', n: '09', title: 'Статус-бар', sub: 'Строка состояния приложения' },
];

const MODEL_OPTIONS = ['MiMo v2.6', 'GPT-5.2', 'Claude 4.7'];

function presetTokens(id: PresetId, hue: number): ThemeTokens {
  if (id !== 'custom') return THEME_PRESETS[id].tokens;
  const hueColor = `hsl(${hue} 14% 47%)`;
  return {
    ...CUSTOM_BASE,
    accentColor: hueColor,
    accentHoverColor: `hsl(${hue} 16% 54%)`,
    accentActiveColor: `hsl(${hue} 14% 41%)`,
    buttonPrimaryBackgroundColor: hueColor,
    buttonPrimaryHoverColor: `hsl(${hue} 16% 54%)`,
    buttonPrimaryActiveColor: `hsl(${hue} 14% 41%)`,
    linkColor: `hsl(${hue} 24% 64%)`,
    focusRingColor: `hsl(${hue} 34% 66%)`,
    selectionBackgroundColor: `hsl(${hue} 18% 26%)`,
  };
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="dl-board-ctl-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

export function BoardScreen() {
  const [preset, setPreset] = useState<PresetId>('dark');
  const [hue, setHue] = useState(120);
  const [fontId, setFontId] = useState('segoe');
  const [typeScale, setTypeScale] = useState(100);
  const [typeWeight, setTypeWeight] = useState(400);
  const [typeArea, setTypeArea] = useState<TypographyArea>('ui');
  const [typeBump, setTypeBump] = useState(0); // форсирует эффект при повторном выборе

  const tokens = presetTokens(preset, hue);
  const fontFamily = FONT_FAMILIES.find((f) => f.id === fontId)?.value ?? FONT_FAMILIES[0].value;

  // Управление страницей — только state: единый эффект пишет токены темы
  // (всегда, чтобы пресет светлой темы сбрасывал custom-правки) и типографику.
  // Запись идёт на #root, значения читаются на .dl-board (наследование var).
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    applyTheme(root, tokens);
    const typography = defaultTypography();
    typography[typeArea].fontFamily = fontFamily;
    typography[typeArea].fontSizePx = Math.round((DEFAULT_TYPE[typeArea].fontSizePx * typeScale) / 100);
    typography[typeArea].weight = typeWeight;
    applyTypography(root, typography);
    // tokens — производная от preset/hue; typeBump — сигнал повторного выбора зоны.
  }, [tokens, fontFamily, typeArea, typeScale, typeWeight, typeBump]);

  const accentPairOk = meetsAA(hexColor(tokens.accentTextColor), hexColor(tokens.accentColor));

  return (
    <div className="dl-board" data-preset={preset}>
      <header className="dl-board-head">
        <div className="dl-board-title">
          Pi WSL Desktop <span>· Компоненты</span>
        </div>
        <div className="dl-board-controls">
          <div className="dl-board-seg" role="group" aria-label="Тема">
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={preset === id ? 'dl-board-seg-btn is-active' : 'dl-board-seg-btn'}
                onClick={() => setPreset(id)}
              >
                {CUSTOM_LABELS[id]}
              </button>
            ))}
            <button
              type="button"
              className={preset === 'custom' ? 'dl-board-seg-btn is-active' : 'dl-board-seg-btn'}
              onClick={() => setPreset('custom')}
            >
              Своя тема
            </button>
          </div>
          <label className="dl-board-ctl-field dl-board-ctl-hue">
            <span>Акцент</span>
            <input
              type="range"
              min={0}
              max={360}
              value={hue}
              disabled={preset !== 'custom'}
              onChange={(e) => setHue(Number(e.target.value))}
            />
          </label>
          <div className="dl-board-seg" role="group" aria-label="Шрифт">
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                className={fontId === f.id ? 'dl-board-seg-btn is-active' : 'dl-board-seg-btn'}
                style={{ fontFamily: f.value }}
                onClick={() => {
                  setFontId(f.id);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <NumberField
            label="Кегль %"
            value={typeScale}
            min={70}
            max={150}
            onChange={(v) => {
              setTypeScale(v);
            }}
          />
          <NumberField
            label="Насыщенность"
            value={typeWeight}
            min={300}
            max={700}
            step={100}
            onChange={(v) => {
              setTypeWeight(v);
            }}
          />
          <label className="dl-board-ctl-field">
            <span>Зона</span>
            <select
              value={typeArea}
              onChange={(e) => {
                const area = e.target.value as TypographyArea;
                setTypeArea(area);
                setTypeBump((n) => n + 1);
              }}
            >
              {TYPOGRAPHY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {TYPE_AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dl-board-head-note">
          Дизайн-система интерфейса · {CUSTOM_LABELS[preset]} тема · Windows / Segoe UI ·{' '}
          <span className={accentPairOk ? 'dl-board-aa ok' : 'dl-board-aa bad'}>
            акцент {accentPairOk ? 'AA ✓' : 'AA ✗'}
          </span>
        </div>
      </header>

      <div className="dl-board-grid">
        {BOARD_CELLS.map((cell) => (
          <section key={cell.id} className={`dl-board-cell cell-${cell.id}`}>
            <div className="dl-board-cell-head">
              <span className="dl-board-cell-n">{cell.n}</span>
              <div>
                <div className="dl-board-cell-title">{cell.title}</div>
                <div className="dl-board-cell-sub">{cell.sub}</div>
              </div>
            </div>
            <div className="dl-board-cell-body">{renderCell(cell.id)}</div>
          </section>
        ))}
      </div>
    </div>
  );

  function renderCell(id: string): ReactNode {
    switch (id) {
      case 'nav':
        return <NavCell />;
      case 'buttons':
        return <ButtonsCell />;
      case 'tabs':
        return <TabsCell />;
      case 'dialog':
        return <DialogCell />;
      case 'actions':
        return <ActionsCell />;
      case 'composer':
        return <ComposerCell />;
      case 'right':
        return <RightCell />;
      case 'terminal':
        return <TerminalCell />;
      case 'status':
        return <StatusCell />;
      default:
        return null;
    }
  }
}

/* ── 01 Навигация ─────────────────────────────────────────────── */

function NavCell() {
  const [active, setActive] = useState('Поиск по истории');
  const [expanded, setExpanded] = useState(true);
  const rows = ['Поиск по истории', 'Настройка проекта', 'Анализ логов'];
  return (
    <div className="dl-board-nav">
      <div className="dl-board-nav-side">
        <Rail
          top={[
            { id: 'toggle', label: 'Показать проекты', icon: <IconPanelExpand size={20} /> },
            { id: 'pi', label: 'Pi', icon: <span className="dl-rail-glyph-inline">π</span> },
            { id: 'new', label: 'Новый диалог', icon: <IconPlus size={22} strokeWidth={2} /> },
            { id: 'search', label: 'Поиск', icon: <IconSearch size={21} /> },
          ]}
          bottom={[]}
        />
        <div className="dl-board-nav-main">
          <div className="dl-board-nav-title">Pi WSL Desktop</div>
          <button
            type="button"
            className="dl-board-nav-toggle"
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            Показать проекты
          </button>
          {expanded ? (
            <>
              <div className="dl-board-nav-label">Недавние чаты</div>
              {rows.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`dl-board-nav-row${active === r ? ' is-active' : ''}`}
                  onClick={() => setActive(r)}
                >
                  <span className="dl-board-nav-row-ic">
                    {active === r ? <span className="dl-rail-glyph-inline sm">π</span> : <IconFolder size={18} />}
                  </span>
                  {r}
                  {active === r ? (
                    <span className="dl-board-nav-row-dots">
                      <IconDots size={16} />
                    </span>
                  ) : null}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>
      <div className="dl-board-nav-rail">
        <Rail
          top={[
            { id: 'toggle', label: 'Развернуть', icon: <IconPanelExpand size={20} /> },
            { id: 'pi', label: 'Pi', icon: <span className="dl-rail-glyph-inline">π</span> },
            { id: 'new', label: 'Новый диалог', icon: <IconPlus size={22} strokeWidth={2} /> },
            { id: 'search', label: 'Поиск', icon: <IconSearch size={21} /> },
          ]}
          bottom={[]}
        />
      </div>
      <div className="dl-board-nav-caps">
        <span>Развернутая панель (320 px)</span>
        <span>Свернутая панель (48 px)</span>
      </div>
    </div>
  );
}

/* ── 02 Кнопки ────────────────────────────────────────────────── */

function ButtonsCell() {
  const [held, setHeld] = useState(false);
  const [panel, setPanel] = useState<'left' | 'right'>('left');
  return (
    <div className="dl-board-buttons">
      <div className="dl-board-sub">Состояния кнопки</div>
      <div className="dl-board-btn-states">
        <div className="dl-board-btn-slot">
          <button type="button" className="dl-board-icon-btn">
            <IconChevronRight size={20} />
          </button>
          <span>Обычное</span>
        </div>
        <div className="dl-board-btn-slot">
          <button type="button" className="dl-board-icon-btn" data-state="hover">
            <IconChevronRight size={20} />
          </button>
          <span>Наведение</span>
        </div>
        <div className="dl-board-btn-slot">
          <button
            type="button"
            className={held ? 'dl-board-icon-btn is-active' : 'dl-board-icon-btn'}
            aria-pressed={held}
            onClick={() => setHeld((v) => !v)}
          >
            <IconChevronRight size={20} />
          </button>
          <span>Активное</span>
        </div>
        <div className="dl-board-btn-slot">
          <button type="button" className="dl-board-icon-btn is-focus">
            <IconChevronRight size={20} />
          </button>
          <span>Фокус</span>
        </div>
        <div className="dl-board-btn-slot">
          <button type="button" className="dl-board-icon-btn" disabled>
            <IconChevronRight size={20} />
          </button>
          <span>Отключено</span>
        </div>
      </div>
      <div className="dl-board-divider" />
      <div className="dl-board-sub">Варианты кнопок панели</div>
      <div className="dl-board-panel-btns">
        <div className="dl-board-btn-slot">
          <button
            type="button"
            className="dl-board-icon-btn is-panel"
            aria-pressed={panel === 'left'}
            onClick={() => setPanel('left')}
          >
            <IconPanelExpand size={20} />
          </button>
          <span>Панель слева</span>
        </div>
        <div className="dl-board-btn-slot">
          <button
            type="button"
            className="dl-board-icon-btn is-panel"
            aria-pressed={panel === 'right'}
            onClick={() => setPanel('right')}
          >
            <IconChevronLeft size={20} />
          </button>
          <span>Панель справа</span>
        </div>
      </div>
    </div>
  );
}

/* ── 03 Вкладки и поиск ───────────────────────────────────────── */

function TabsCell() {
  const [tab, setTab] = useState<'overview' | 'files' | 'mcp'>('overview');
  const [q, setQ] = useState('');
  return (
    <div className="dl-board-tabs">
      <div className="dl-details-tabs" role="tablist">
        {([
          ['overview', 'Обзор'],
          ['files', 'Файлы'],
          ['mcp', 'MCP'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`dl-tab${tab === id ? ' dl-tab-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="dl-board-ext-tab" aria-pressed={tab === 'mcp'} onClick={() => setTab('mcp')}>
          <IconPlus size={16} />
          Расширения
        </button>
      </div>
      <div className="dl-board-search">
        <IconSearch size={19} strokeWidth={1.7} />
        <input
          type="text"
          value={q}
          placeholder="Поиск по истории"
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск по истории"
        />
        <button type="button" className="dl-board-search-go" aria-label="Найти" disabled={!q.trim()}>
          <IconChevronRight size={18} />
        </button>
      </div>
      <div className="dl-board-search-count">{q ? `Найдено совпадений: ${q.length}` : 'Введите запрос'}</div>
    </div>
  );
}

/* ── 04 Диалог ────────────────────────────────────────────────── */

const BOARD_TURNS: ChatTurn[] = [
  {
    kind: 'user',
    id: 'b-user',
    text: 'Добавь поиск по истории диалогов. Хочу находить нужный чат по названию и тексту.',
  },
  {
    kind: 'assistant',
    id: 'b-assistant',
    name: 'Pi',
    body: 'Добавлю поиск в боковую панель. Он будет находить диалоги по названию и содержимому.',
  },
];

function DialogCell() {
  return (
    <div className="dl-board-dialog">
      <ChatView turns={BOARD_TURNS} composer={{ density: 'standard' }} />
    </div>
  );
}

/* ── 05 Действия Pi ───────────────────────────────────────────── */

function ActionsCell() {
  const [running, setRunning] = useState(true);
  return (
    <div className="dl-board-actions">
      <div className="dl-steps" style={{ '--dl-step-circle': '26px' } as CSSProperties}>
        <div className="dl-step">
          <span className="dl-step-check">
            <StepGlyph kind="done" size={26} />
          </span>
          <span className="dl-step-text">Изучены 4 файла</span>
          <span className="dl-step-chevron">
            <IconChevronDown size={17} />
          </span>
        </div>
        <div className="dl-step dl-step-active">
          <span className="dl-step-check">
            <StepGlyph kind={running ? 'running' : 'done'} size={26} />
          </span>
          <span className="dl-step-col">
            <span className="dl-step-text">Добавлен поиск по истории</span>
            <span className="dl-board-step-status">{running ? 'Выполняется…' : 'Готово'}</span>
          </span>
          <span className="dl-board-step-pct">{running ? '18%' : '100%'}</span>
          <span className="dl-step-chevron">
            <IconChevronDown size={17} />
          </span>
        </div>
        <button type="button" className="dl-step" onClick={() => setRunning((v) => !v)}>
          <span className="dl-step-check">
            <StepGlyph kind="done" size={26} />
          </span>
          <span className="dl-step-text">Проверки пройдены</span>
          <span className="dl-step-chevron">
            <IconChevronDown size={17} />
          </span>
        </button>
        <div className="dl-step">
          <span className="dl-step-check">
            <StepGlyph kind="error" size={26} />
          </span>
          <span className="dl-step-text">Ошибка при проверке типов</span>
          <span className="dl-step-chevron">
            <IconChevronDown size={17} />
          </span>
        </div>
      </div>
      <div className="dl-board-actions-note">Нажатие на строку «Проверки пройдены» — переключает прогресс сверху</div>
    </div>
  );
}

function StepGlyph({ kind, size }: { kind: 'done' | 'running' | 'error'; size: number }) {
  if (kind === 'running') {
    return <span className="dl-board-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  if (kind === 'error') {
    return (
      <span className="dl-board-step-err" style={{ width: size, height: size }} aria-hidden="true">
        <IconClose size={Math.round(size * 0.55)} />
      </span>
    );
  }
  return <StepDone size={size} />;
}

function StepDone({ size }: { size: number }) {
  return (
    <span className="dl-board-step-done" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M7 12.5l3.2 3.2L17 9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" />
      </svg>
    </span>
  );
}

/* ── 06 Поле ввода ────────────────────────────────────────────── */

function ComposerCell() {
  const [text, setText] = useState('');
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  return (
    <div className="dl-board-composer">
      <div className="dl-board-composer-box">
        <div className="dl-composer-row1">
          <span className="dl-composer-attach">
            <ComposerClip />
          </span>
          <input
            className="dl-composer-input"
            value={text}
            placeholder="Напишите сообщение..."
            onChange={(e) => setText(e.target.value)}
            aria-label="Сообщение"
          />
        </div>
        <div className="dl-composer-row2">
          <div className="dl-board-model">
            <button type="button" className="dl-chip" aria-expanded={modelOpen} onClick={() => setModelOpen((v) => !v)}>
              {model}
              <span className="dl-chip-chevron">
                <IconChevronDown size={16} />
              </span>
            </button>
            {modelOpen ? (
              <div className="dl-board-model-menu" role="listbox">
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={m === model}
                    className={m === model ? 'is-active' : ''}
                    onClick={() => {
                      setModel(m);
                      setModelOpen(false);
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="dl-context">
            Контекст 18%
            <span className="dl-board-info" aria-label="Контекст окна">
              i
            </span>
          </span>
        </div>
        <button type="button" className="dl-btn-primary dl-send" aria-label="Отправить">
          <ComposerArrow />
        </button>
      </div>
      <div className="dl-board-sub">Вариант с остановкой генерации</div>
      <div className="dl-board-composer-box is-stop">
        <div className="dl-composer-row1">
          <span className="dl-composer-attach">
            <ComposerClip />
          </span>
          <input
            className="dl-composer-input"
            value={text}
            placeholder="Напишите сообщение..."
            onChange={(e) => setText(e.target.value)}
            aria-label="Сообщение (стоп)"
          />
        </div>
        <button
          type="button"
          className={stopped ? 'dl-board-stop is-stopped' : 'dl-board-stop'}
          aria-pressed={stopped}
          aria-label="Остановить генерацию"
          onClick={() => setStopped((v) => !v)}
        >
          <span />
        </button>
      </div>
    </div>
  );
}

function ComposerClip() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9.5 17.5l7-7a3 3 0 10-4.24-4.24l-7.5 7.5a5 5 0 007.07 7.07l7.07-7.07" strokeLinecap="round" />
    </svg>
  );
}

function ComposerArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5.5M5.5 12L12 5.5 18.5 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── 07 Правая панель ─────────────────────────────────────────── */

function RightCell() {
  const [tab, setTab] = useState<'overview' | 'files'>('overview');
  return (
    <div className="dl-board-right">
      <div className="dl-board-right-head">
        <span className="dl-details-title">Детали действия</span>
        <button type="button" className="dl-btn-ghost dl-collapse-btn" aria-label="Свернуть панель">
          <IconChevronRight size={18} />
        </button>
      </div>
      <div className="dl-board-right-body">
        <div className="dl-details-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'overview'}
            className={`dl-tab${tab === 'overview' ? ' dl-tab-active' : ''}`}
            onClick={() => setTab('overview')}
          >
            Обзор
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'files'}
            className={`dl-tab${tab === 'files' ? ' dl-tab-active' : ''}`}
            onClick={() => setTab('files')}
          >
            Файлы
          </button>
        </div>
        {tab === 'overview' ? (
          <DetailsPanel
            tabs={[]}
            pill="Выполнено"
            title="Поиск по истории"
            subtitle="Диалоги находятся по названию и тексту."
            filesLabel="Изменённые файлы"
            files={[
              { id: 'f1', name: 'SessionsView.tsx' },
              { id: 'f2', name: 'sessionSearch.ts' },
              { id: 'f3', name: 'sessionSearch.test.ts' },
            ]}
            checksLabel="Проверки"
            checks={[
              { id: 'c1', text: 'Поиск по названию' },
              { id: 'c2', text: 'Поиск по содержимому' },
            ]}
            footer="3 файла · Все проверки пройдены"
          />
        ) : (
          <div className="dl-board-files-tab">
            <div className="dl-file-rows">
              {[
                'sessionSearch.test.ts',
                'sessions.css',
                'design-lab/fixtures.tsx',
              ].map((n) => (
                <div key={n} className="dl-file">
                  <span className="dl-file-icon">
                    <IconFileDoc size={24} />
                  </span>
                  {n}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 08 Терминал ──────────────────────────────────────────────── */

function TerminalCell() {
  const [active, setActive] = useState('Ubuntu · bash');
  const [extra, setExtra] = useState<string[]>([]);
  const all = ['Ubuntu · bash'].concat(extra);
  return (
    <div className="dl-board-terminal">
      <TerminalPane
        tabs={all.map((t) => ({
          id: t,
          label: t,
          active: active === t,
          closable: true,
          icon: t.startsWith('Ubuntu') ? <IconTerminalGlyph size={16} /> : undefined,
        }))}
        onSelectTab={setActive}
        onAddTab={() => {
          const name = `logs · ${extra.length + 1}`;
          setExtra((v) => [...v, name]);
          setActive(name);
        }}
        onCloseTab={(id) => {
          if (id === 'Ubuntu · bash') return; // системная вкладка не закрывается
          setExtra((v) => {
            const next = v.filter((t) => t !== id);
            if (active === id) setActive(next[next.length - 1] ?? 'Ubuntu · bash');
            return next;
          });
        }}
        lines={[
          <span key="p1" className="t-blue">
            triag@ubuntu:~/projects/pi-wsl-desktop$ npm run test
          </span>,
          <span key="m1" className="t-muted">
            &gt; pi-wsl-desktop test
          </span>,
          <span key="m2" className="t-muted">
            &gt; vitest run
          </span>,
          '',
          <span key="s1" className="t-green">
            ✓ tests/sessionSearch.test.ts (8 tests)
          </span>,
          <span key="p2">
            <b> Test Files</b> 1 passed (1)
          </span>,
          <span key="p3">
            <b> Tests</b> 8 passed (8)
          </span>,
          <span key="p4" className="t-blue">
            triag@ubuntu:~/projects/pi-wsl-desktop{' '}
          </span>,
        ]}
      />
      <div className="dl-board-term-row">
        <span className="dl-board-sub">Вкладки переключаются, «+» открывает новую, «×» закрывает</span>
      </div>
    </div>
  );
}

/* ── 09 Статус-бар ───────────────────────────────── */

function StatusCell() {
  const [term, setTerm] = useState(false);
  return (
    <div className="dl-board-status">
      <span className="dl-board-sub dl-board-status-hint">Нажмите «Терминал» в строке — переключение</span>
      <div className="dl-status">
        <StatusBar
          connection={{ label: 'Pi подключён' }}
          distro="Ubuntu · WSL"
          right={[
            { id: 'cpu', text: 'CPU 12%', icon: <CpuGlyph /> },
            { id: 'ram', text: 'RAM 8,4 / 32 ГБ', icon: <RamGlyph /> },
          ]}
          terminalLabel="Терминал"
          onTerminalToggle={() => setTerm((v) => !v)}
          terminalActive={term}
        />
      </div>
    </div>
  );
}

function CpuGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" strokeLinecap="round" />
    </svg>
  );
}

function RamGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="7.5" width="17" height="9" rx="2" />
      <path d="M7.5 10.5v3M12 10.5v3M16.5 10.5v3" strokeLinecap="round" />
    </svg>
  );
}

export { DEFAULT_TYPE };
