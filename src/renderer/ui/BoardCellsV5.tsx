/**
 * Design Lab — ячейки 10–36 страницы «Компоненты» (Issue #21 / D1-b, раунд 3).
 *
 * Источник истины: Reference/Pi-WSL-Desktop-Component-Library-v5.zip
 * (components.json + preview-cases.json) — анатомия, варианты и контракты v5.
 * Визуальная стилистика — как у ячеек 01–09 того же board: токены --pw-*,
 * размеры в em, живые переключатели. Только fixture: без Electron, Pi, WSL,
 * IPC и user ~/.pi (D1-контракт).
 *
 * id в v5: dialog → 'modal' (id 'dialog' уже занят ячейкой 04 «Диалог»).
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { edgeIndex, nextIndex, useOverlayDismiss } from './overlayA11y';
import {
  IconBookDoc,
  IconChatBubble,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCode,
  IconCpu,
  IconDatabase,
  IconDots,
  IconFileDoc,
  IconFolder,
  IconGear,
  IconInfo,
  IconMemory,
  IconMonitor,
  IconPlus,
  IconPuzzle,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTerminalGlyph,
} from './icons';

export interface V5CellMeta {
  id: string;
  n: string;
  title: string;
  sub: string;
}

/** Метаданные ячеек v5 (реестр components.json, порядок библиотеки). */
export const V5_CELLS: V5CellMeta[] = [
  { id: 'type', n: '10', title: 'Типографика', sub: 'Typography · шкала: заголовок, текст, пояснение, код' },
  { id: 'icons', n: '11', title: 'Иконки', sub: 'Icon · контуры 16/20/24 px, единая толщина линий' },
  { id: 'select', n: '12', title: 'Выбор из списка', sub: 'Select · значение и шеврон, короткий список' },
  { id: 'switch', n: '13', title: 'Переключатель', sub: 'Switch · два положения и подпись, третьего нет' },
  { id: 'checkbox', n: '14', title: 'Флажок', sub: 'Checkbox · одиночный и частичный выбор группы' },
  { id: 'radio', n: '15', title: 'Одиночный выбор', sub: 'Choice · радиогруппа и сегменты' },
  { id: 'slider', n: '16', title: 'Диапазон', sub: 'Range · ползунок с точным числовым вводом' },
  { id: 'menu', n: '17', title: 'Меню действий', sub: 'ActionMenu · popover, группы, клавиши' },
  { id: 'badge', n: '18', title: 'Статус', sub: 'Status · текст и пиктограмма, не только цвет' },
  { id: 'progress', n: '19', title: 'Ход операции', sub: 'Progress · процент, ожидание, skeleton' },
  { id: 'attachment', n: '20', title: 'Вложение', sub: 'Attachment · файл, изображение, ошибка' },
  { id: 'context', n: '21', title: 'Контекст', sub: 'ContextBreakdown · доли, окно, источники' },
  { id: 'filetree', n: '22', title: 'Дерево', sub: 'TreeView · файлы и ветки диалога' },
  { id: 'filepreview', n: '23', title: 'Просмотр кода', sub: 'CodeViewer · номера строк и цитирование' },
  { id: 'diff', n: '24', title: 'Изменения', sub: 'DiffViewer · unified и side-by-side' },
  { id: 'setting', n: '25', title: 'Строка настройки', sub: 'SettingRow · подпись, описание, слот контроля' },
  { id: 'theme', n: '26', title: 'Редактор темы', sub: 'ThemeEditor · пресет, токены, preview, сохранение' },
  { id: 'runtime', n: '27', title: 'Проверка окружения', sub: 'EnvironmentCheck · результаты и время проверки' },
  { id: 'resource', n: '28', title: 'Ресурс', sub: 'ResourceItem · Skill, Extension, MCP, Module' },
  { id: 'metrics', n: '29', title: 'Показатели', sub: 'MetricGroup · значения, qualifiers, helper' },
  { id: 'chart', n: '30', title: 'График', sub: 'TimeSeriesChart · оси, легенда, точные значения' },
  { id: 'heatmap', n: '31', title: 'Активность', sub: 'ActivityGrid · календарь 7×4, шкала интенсивности' },
  { id: 'table', n: '32', title: 'Таблица', sub: 'DataTable · заголовки, сортировка, числа справа' },
  { id: 'alert', n: '33', title: 'Сообщение в контексте', sub: 'InlineAlert · информация, предупреждение, ошибка' },
  { id: 'toast', n: '34', title: 'Уведомление', sub: 'Toast · результат, отмена, dismiss' },
  { id: 'modal', n: '35', title: 'Модальный диалог', sub: 'Dialog · подтверждение и возврат фокуса' },
  { id: 'empty', n: '36', title: 'Пустое состояние', sub: 'EmptyState · нет данных, совпадений, связи' },
];

export function V5Body({ id }: { id: string }) {
  switch (id) {
    case 'type':
      return <TypeCell />;
    case 'icons':
      return <IconsCell />;
    case 'select':
      return <SelectCell />;
    case 'switch':
      return <SwitchCell />;
    case 'checkbox':
      return <CheckboxCell />;
    case 'radio':
      return <RadioCell />;
    case 'slider':
      return <SliderCell />;
    case 'menu':
      return <MenuCell />;
    case 'badge':
      return <BadgeCell />;
    case 'progress':
      return <ProgressCell />;
    case 'attachment':
      return <AttachmentCell />;
    case 'context':
      return <ContextCell />;
    case 'filetree':
      return <TreeCell />;
    case 'filepreview':
      return <CodeCell />;
    case 'diff':
      return <DiffCell />;
    case 'setting':
      return <SettingCell />;
    case 'theme':
      return <ThemeCell />;
    case 'runtime':
      return <RuntimeCell />;
    case 'resource':
      return <ResourceCell />;
    case 'metrics':
      return <MetricsCell />;
    case 'chart':
      return <ChartCell />;
    case 'heatmap':
      return <HeatmapCell />;
    case 'table':
      return <TableCell />;
    case 'alert':
      return <AlertCell />;
    case 'toast':
      return <ToastCell />;
    case 'modal':
      return <ModalCell />;
    case 'empty':
      return <EmptyCell />;
    default:
      return null;
  }
}

/* ─── общие мини-примитивы ──────────────────────────────────────────── */

function Seg({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="v5-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? 'is-active' : ''}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="v5-track"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="v5-thumb" />
    </button>
  );
}

function WarnGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3.6 21.4 20H2.6L12 3.6z" strokeLinejoin="round" />
      <path d="M12 9.8v4.4M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}

function ErrGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" strokeLinecap="round" />
    </svg>
  );
}

/* ─── 10–11: основа ─────────────────────────────────────────────────── */

function TypeCell() {
  return (
    <div className="v5-type">
      <div className="v5-type-h">Заголовок раздела</div>
      <div className="v5-type-body">Основной текст ответа Pi читается в потоке диалога.</div>
      <div className="v5-type-cap">Пояснение, метаданные и вторичная строка</div>
      <code className="v5-type-code">npm run design → localhost:5199</code>
    </div>
  );
}

function IconsCell() {
  const items: { node: ReactNode; label: string }[] = [
    { node: <IconSearch size={20} />, label: 'search' },
    { node: <IconGear size={20} />, label: 'settings' },
    { node: <IconFolder size={20} />, label: 'folder' },
    { node: <IconFileDoc size={20} />, label: 'file' },
    { node: <IconTerminalGlyph size={20} />, label: 'terminal' },
    { node: <IconCode size={20} />, label: 'code' },
    { node: <IconDatabase size={20} />, label: 'database' },
    { node: <IconPuzzle size={20} />, label: 'puzzle' },
    { node: <IconBookDoc size={20} />, label: 'book' },
    { node: <IconShield size={20} />, label: 'shield' },
    { node: <IconCpu size={20} />, label: 'cpu' },
    { node: <IconMemory size={20} />, label: 'memory' },
    { node: <IconMonitor size={20} />, label: 'monitor' },
    { node: <IconChatBubble size={20} />, label: 'chat' },
    { node: <IconRefresh size={20} />, label: 'refresh' },
    { node: <IconPlus size={20} />, label: 'plus' },
  ];
  return (
    <div className="v5-icons">
      <div className="v5-icons-grid">
        {items.map((it) => (
          <span key={it.label} className="v5-icons-cell" title={it.label} aria-label={it.label}>
            {it.node}
          </span>
        ))}
      </div>
      <div className="v5-icons-sizes">
        <span>
          <IconGear size={16} /> 16 px
        </span>
        <span>
          <IconGear size={20} /> 20 px
        </span>
        <span>
          <IconGear size={24} /> 24 px
        </span>
      </div>
    </div>
  );
}

/* ─── 12–17: управление ─────────────────────────────────────────────── */

function SelectCell() {
  const options = ['Ubuntu 24.04', 'Debian 12', 'Alpine 3.20'];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(options[0]);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = 'v5-select-listbox';

  useOverlayDismiss({
    open,
    rootRef: wrapRef,
    onDismiss: () => setOpen(false),
    returnFocusRef: triggerRef,
  });

  /* Фокус живёт на настоящей опции, а не на триггере: aria-activedescendant
   * на нативной кнопке не поддерживается и не озвучивался скринридером. */
  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.focus();
  }, [open, active]);

  const openList = () => {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };
  const commit = (index: number) => {
    setValue(options[index]);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openList();
    }
  };

  // Стрелки/Home/End приходят от самих опций (фокус внутри listbox).
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => nextIndex(i, options.length, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => nextIndex(i, options.length, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(edgeIndex(options.length, 'first'));
        break;
      case 'End':
        event.preventDefault();
        setActive(edgeIndex(options.length, 'last'));
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="v5-select-wrap" ref={wrapRef}>
      <span className="v5-lbl">Дистрибутив</span>
      <button
        type="button"
        ref={triggerRef}
        className="v5-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{value}</span>
        <span className={open ? 'v5-chev rot' : 'v5-chev'}>
          <IconChevronDown size={16} />
        </span>
      </button>
      {open && (
        <ul className="v5-listbox" id={listId} role="listbox" aria-label="Дистрибутив" onKeyDown={onListKeyDown}>
          {options.map((o, index) => (
            <li key={o}>
              <button
                type="button"
                ref={(el) => { optionRefs.current[index] = el; }}
                role="option"
                aria-selected={o === value}
                tabIndex={-1}
                className={`${o === value ? 'is-active' : ''}${index === active ? ' is-focus' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    commit(index);
                  }
                }}
              >
                <span>{o}</span>
                {o === value && <IconCheck size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SwitchCell() {
  const [auto, setAuto] = useState(true);
  const [expand, setExpand] = useState(false);
  return (
    <div className="v5-stack">
      <div className="v5-srow">
        <Switch checked={auto} onChange={setAuto} label="Автосохранение черновика" />
        <div className="v5-srow-txt">
          <div className="v5-srow-label">Автосохранение черновика</div>
          <div className="v5-srow-desc">Текст сохраняется при паузе ввода</div>
        </div>
      </div>
      <div className="v5-srow">
        <Switch checked={expand} onChange={setExpand} label="Развёрнутые результаты" />
        <div className="v5-srow-txt">
          <div className="v5-srow-label">Развёрнутые результаты</div>
          <div className="v5-srow-desc">Открывать результаты инструментов сразу</div>
        </div>
      </div>
      <div className="v5-srow is-off">
        <Switch checked={false} onChange={() => {}} disabled label="Режим только чтения" />
        <div className="v5-srow-txt">
          <div className="v5-srow-label">Режим только чтения</div>
          <div className="v5-srow-desc">Недоступно для профиля владельца</div>
        </div>
      </div>
    </div>
  );
}

function CheckboxCell() {
  const files = [
    { id: 'setup', name: 'setup.sh' },
    { id: 'guard', name: 'nsis-guard.nsh' },
    { id: 'readme', name: 'README.md' },
  ];
  const [sel, setSel] = useState<Record<string, boolean>>({ setup: true, guard: true, readme: false });
  const all = files.every((f) => sel[f.id]);
  const some = !all && files.some((f) => sel[f.id]);
  const toggleAll = () => {
    const next = !all;
    setSel({ setup: next, guard: next, readme: next });
  };
  const toggle = (id: string) => setSel((s) => ({ ...s, [id]: !s[id] }));
  return (
    <div className="v5-stack">
      <button type="button" role="checkbox" aria-checked={some ? 'mixed' : all} className="v5-cb-row" onClick={toggleAll}>
        <span className={some ? 'v5-cb is-mixed' : all ? 'v5-cb is-on' : 'v5-cb'}>
          {all && <IconCheck size={11} strokeWidth={2.6} />}
        </span>
        <span className="v5-srow-label">{some ? 'Частично выбрано' : all ? 'Все файлы выбраны' : 'Выбрать все'}</span>
      </button>
      {files.map((f) => (
        <button key={f.id} type="button" role="checkbox" aria-checked={sel[f.id]} className="v5-cb-row" onClick={() => toggle(f.id)}>
          <span className={sel[f.id] ? 'v5-cb is-on' : 'v5-cb'}>{sel[f.id] && <IconCheck size={11} strokeWidth={2.6} />}</span>
          <span className="v5-cb-name">{f.name}</span>
        </button>
      ))}
    </div>
  );
}

function RadioCell() {
  const [mode, setMode] = useState('dark');
  const [fmt, setFmt] = useState('unified');
  return (
    <div className="v5-stack">
      <div>
        <span className="v5-lbl">Режим темы (сегменты)</span>
        <Seg
          label="Режим темы"
          value={mode}
          onChange={setMode}
          options={[
            { id: 'dark', label: 'Тёмная' },
            { id: 'light', label: 'Светлая' },
            { id: 'auto', label: 'Как в системе' },
          ]}
        />
      </div>
      <div>
        <span className="v5-lbl">Формат diff (радиогруппа)</span>
        <div className="v5-radios" role="radiogroup" aria-label="Формат diff">
          {[
            { id: 'unified', label: 'Unified' },
            { id: 'split', label: 'Side by side' },
          ].map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={fmt === o.id} className="v5-radio" onClick={() => setFmt(o.id)}>
              <span className="v5-radio-dot" />
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SliderCell() {
  const [v, setV] = useState(100);
  const px = Math.round((14 * v) / 100);
  return (
    <div className="v5-stack">
      <div className="v5-slider-head">
        <span className="v5-lbl">Размер текста</span>
        <span className="v5-slider-val">
          <input
            className="v5-num"
            type="number"
            min={70}
            max={150}
            step={5}
            value={v}
            aria-label="Размер текста, проценты"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setV(Math.min(150, Math.max(70, n)));
            }}
          />
          %
        </span>
      </div>
      <input
        className="v5-range"
        type="range"
        min={70}
        max={150}
        step={5}
        value={v}
        aria-label="Размер текста, проценты"
        onChange={(e) => setV(Number(e.target.value))}
      />
      <div className="v5-slider-ends">
        <span>70</span>
        <span>150</span>
      </div>
      <div className="v5-slider-prev" style={{ fontSize: `${px}px` }}>
        Съедобный пример текста
      </div>
    </div>
  );
}

function MenuCell() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = 'v5-menu-box';

  const ITEMS = ['Копировать ссылку', 'Переименовать', 'Архивировать', 'Удалить'];

  useOverlayDismiss({
    open,
    rootRef: wrapRef,
    onDismiss: () => setOpen(false),
    returnFocusRef: triggerRef,
  });

  // Открытое меню уводит фокус внутрь — иначе стрелки/Escape попадают в пустоту.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  const run = (name: string) => {
    setLast(name);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActive(0);
      setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(ITEMS.length - 1);
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => nextIndex(i, ITEMS.length, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => nextIndex(i, ITEMS.length, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(edgeIndex(ITEMS.length, 'first'));
        break;
      case 'End':
        event.preventDefault();
        setActive(edgeIndex(ITEMS.length, 'last'));
        break;
      case 'Tab':
        setOpen(false);
        break;
      case 'Escape':
        // Escape обрабатывает useOverlayDismiss (закрытие + возврат фокуса).
        break;
      default:
        break;
    }
  };

  return (
    <div className="v5-stack">
      <div className="v5-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          ref={triggerRef}
          className="v5-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
        >
          <IconDots size={16} />
          Ещё
        </button>
        {open && (
          <div
            className="v5-listbox v5-menu-box"
            id={menuId}
            role="menu"
            aria-label="Действия"
            onKeyDown={onMenuKeyDown}
          >
            <button
              type="button"
              role="menuitem"
              ref={(el) => { itemRefs.current[0] = el; }}
              tabIndex={-1}
              onClick={() => run('Копировать ссылку')}
            >
              <span>Копировать ссылку</span>
              <kbd>Ctrl+C</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              ref={(el) => { itemRefs.current[1] = el; }}
              tabIndex={-1}
              onClick={() => run('Переименовать')}
            >
              <span>Переименовать</span>
              <kbd>F2</kbd>
            </button>
            <div className="v5-listbox-sep" />
            <button
              type="button"
              role="menuitem"
              ref={(el) => { itemRefs.current[2] = el; }}
              tabIndex={-1}
              onClick={() => run('Архивировать')}
            >
              <span>Архивировать</span>
            </button>
            <button
              type="button"
              role="menuitem"
              ref={(el) => { itemRefs.current[3] = el; }}
              tabIndex={-1}
              className="is-danger"
              onClick={() => run('Удалить')}
            >
              <span>Удалить</span>
            </button>
          </div>
        )}
      </div>
      <div className="v5-cap">{last ? `Действие: ${last}` : 'Меню закрыто — выберите действие'}</div>
    </div>
  );
}

function BadgeCell() {
  const items: { tone: string; label: string; icon: ReactNode }[] = [
    { tone: 'ok', label: 'Готово', icon: <IconCheckCircle size={13} /> },
    { tone: 'warn', label: 'Есть предупреждение', icon: <WarnGlyph /> },
    { tone: 'error', label: 'Ошибка запуска', icon: <ErrGlyph /> },
    { tone: 'idle', label: 'Ожидание', icon: <IconInfo size={13} /> },
    { tone: 'pending', label: 'Проверка…', icon: <span className="v5-spin" /> },
  ];
  return (
    <div className="v5-badges">
      {items.map((b) => (
        <span key={b.label} className={`v5-badge is-${b.tone}`}>
          {b.icon}
          {b.label}
        </span>
      ))}
    </div>
  );
}

function ProgressCell() {
  return (
    <div className="v5-stack">
      <div>
        <div className="v5-prog-head">
          <span>Индексация файлов</span>
          <b>62%</b>
        </div>
        <div className="v5-bar">
          <span style={{ width: '62%' }} />
        </div>
      </div>
      <div>
        <div className="v5-prog-head">
          <span>Ожидание ответа Pi</span>
          <span className="v5-cap">без выдуманного процента</span>
        </div>
        <div className="v5-bar is-indet">
          <span />
        </div>
      </div>
      <div className="v5-skel" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

/* ─── 20–24: диалог и рабочие области ───────────────────────────────── */

function AttachmentCell() {
  type Att = { id: string; kind: 'file' | 'image' | 'error'; name: string; meta: string };
  const INITIAL: Att[] = [
    { id: 'f1', kind: 'file', name: 'release-notes.md', meta: '4,2 КБ' },
    { id: 'f2', kind: 'image', name: 'shell-dark.png', meta: '128 КБ' },
    { id: 'f3', kind: 'error', name: 'session-log.txt', meta: 'ошибка загрузки' },
  ];
  const [items, setItems] = useState<Att[]>(INITIAL);
  const removed = INITIAL.length - items.length;
  return (
    <div className="v5-stack">
      {items.map((a) => (
        <div key={a.id} className={`v5-att is-${a.kind}`}>
          <span className="v5-att-icon">
            {a.kind === 'image' ? <IconMonitor size={15} /> : a.kind === 'error' ? <ErrGlyph /> : <IconFileDoc size={15} />}
          </span>
          <span className="v5-att-name">{a.name}</span>
          <span className={a.kind === 'error' ? 'v5-att-meta is-err' : 'v5-att-meta'}>{a.meta}</span>
          <button
            type="button"
            className="v5-att-x"
            aria-label={a.kind === 'error' ? `Повторить загрузку ${a.name}` : `Убрать ${a.name}`}
            onClick={() => {
              if (a.kind === 'error') {
                setItems((list) => list.map((x) => (x.id === a.id ? { ...x, kind: 'file', meta: '12,4 КБ' } : x)));
              } else {
                setItems((list) => list.filter((x) => x.id !== a.id));
              }
            }}
          >
            {a.kind === 'error' ? <IconRefresh size={13} /> : <IconClose size={13} />}
          </button>
        </div>
      ))}
      <div className="v5-row-between">
        <span className="v5-cap">{items.length} из {INITIAL.length} вложений · retry у ошибки чинит файл</span>
        {removed > 0 && (
          <button type="button" className="v5-link" onClick={() => setItems(INITIAL)}>
            Вернуть ({removed})
          </button>
        )}
      </div>
    </div>
  );
}

function ContextCell() {
  const sources = [
    { label: 'Системный промпт', value: '18K', share: 40, tone: 'a' },
    { label: 'Инструменты (оценка)', value: '7K', share: 35, tone: 'b' },
    { label: 'Диалог', value: '11K', share: 25, tone: 'c' },
  ];
  return (
    <div className="v5-stack">
      <div className="v5-row-between">
        <b className="v5-ctx-title">Контекст 18%</b>
        <span className="v5-cap">36K / 200K</span>
      </div>
      <div className="v5-meter" role="img" aria-label="Система 40%, инструменты 35%, диалог 25%">
        <i className="t-a" style={{ width: '40%' }} />
        <i className="t-b" style={{ width: '35%' }} />
        <i className="t-c" style={{ width: '25%' }} />
      </div>
      <div className="v5-stack v5-tight">
        {sources.map((s) => (
          <div key={s.label} className="v5-row-between">
            <span className="v5-ctx-src">
              <i className={`dot t-${s.tone}`} />
              {s.label}
            </span>
            <span className="v5-cap">
              {s.value} · {s.share}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TreeCell() {
  const [open, setOpen] = useState<Record<string, boolean>>({ src: true, renderer: true, tests: false });
  const [sel, setSel] = useState('BoardScreen.tsx');
  const row = (depth: number, node: string, kind: 'dir' | 'file') => {
    const isDir = kind === 'dir';
    const isOpen = isDir && open[node];
    return (
      <div key={node} className={`v5-tree-row${sel === node ? ' is-sel' : ''}`} style={{ paddingLeft: `${depth * 16 + 4}px` }}>
        <button
          type="button"
          className="v5-tree-toggle"
          aria-expanded={isDir ? Boolean(isOpen) : undefined}
          aria-label={isDir ? `${isOpen ? 'Свернуть' : 'Развернуть'} ${node}` : undefined}
          onClick={() => (isDir ? setOpen((o) => ({ ...o, [node]: !o[node] })) : setSel(node))}
        >
          {isDir ? (
            <span className={isOpen ? 'v5-chev tree rot' : 'v5-chev tree'}>
              <IconChevronRight size={13} />
            </span>
          ) : (
            <span className="v5-tree-file">
              <IconFileDoc size={13} />
            </span>
          )}
        </button>
        <span className="v5-tree-name" onClick={() => !isDir && setSel(node)}>
          {isDir ? <IconFolder size={13} /> : null}
          {node}
        </span>
        {sel === node && <span className="v5-tree-mark">выбрано</span>}
      </div>
    );
  };
  return (
    <div className="v5-tree">
      {row(0, 'src', 'dir')}
      {open.src && row(1, 'renderer', 'dir')}
      {open.src && open.renderer ? row(2, 'BoardScreen.tsx', 'file') : null}
      {open.src && open.renderer ? row(2, 'StatusBar.tsx', 'file') : null}
      {row(0, 'tests', 'dir')}
      {open.tests && row(1, 'app.spec.ts', 'file')}
      <div className="v5-tree-row is-branch">
        <span className="v5-tree-mark-inline">⎇ main</span>
        <span className="v5-cap">ветка диалога — тот же renderer узлов</span>
      </div>
    </div>
  );
}

function CodeCell() {
  const [quoted, setQuoted] = useState(false);
  const lines: { n: string; code: ReactNode }[] = [
    { n: '1', code: <>export function StatusBar(props) {'{'}</> },
    {
      n: '2',
      code: (
        <>
          {'  '}
          <span className="kw">return</span> (
        </>
      ),
    },
    {
      n: '3',
      code: (
        <>
          {'    '}
          <span className="p">{'<'}</span>
          <span className="fn">div</span> className=<span className="st">&quot;dl-status-bar&quot;</span>
          <span className="p">{'>'}</span>
        </>
      ),
    },
    {
      n: '4',
      code: (
        <>
          {'      '}
          <span className="st">&quot;_&gt; Терминал&quot;</span>
        </>
      ),
    },
    { n: '5', code: <> {'  }'} </> },
  ];
  return (
    <div className="v5-code-wrap">
      <div className="v5-code-head">
        <span className="v5-code-path">
          <IconFileDoc size={13} />
          src/renderer/ui/StatusBar.tsx
        </span>
        <button
          type="button"
          className={quoted ? 'v5-code-quote is-on' : 'v5-code-quote'}
          aria-pressed={quoted}
          onClick={() => setQuoted((q) => !q)}
        >
          {quoted ? 'Вставлено в чат' : 'Цитировать'}
        </button>
      </div>
      <pre className="v5-code">
        <code>
          {lines.map((l) => (
            <span key={l.n} className="v5-code-line">
              <span className="v5-gutter">{l.n}</span>
              <span>{l.code}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function DiffCell() {
  const [mode, setMode] = useState('unified');
  const unified: { n: string; kind: 'ctx' | 'del' | 'add'; text: string }[] = [
    { n: '14', kind: 'ctx', text: '.dl-frame {' },
    { n: '15', kind: 'del', text: '  background: var(--pw-surface);' },
    { n: '15', kind: 'add', text: '  background: var(--pw-window);' },
    { n: '16', kind: 'add', text: '  border: 1px solid var(--pw-border);' },
    { n: '17', kind: 'ctx', text: '}' },
  ];
  return (
    <div className="v5-stack v5-tight">
      <div className="v5-row-between">
        <span className="v5-code-path">
          <IconCode size={13} />
          src/renderer/design/layout.css
        </span>
        <span className="v5-diff-stat">
          <b className="is-add">+12</b> <b className="is-del">−4</b>
        </span>
      </div>
      <Seg
        label="Режим diff"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'unified', label: 'Unified' },
          { id: 'split', label: 'Side by side' },
        ]}
      />
      {mode === 'unified' ? (
        <div className="v5-diff">
          {unified.map((l, i) => (
            <div key={i} className={`v5-diff-line is-${l.kind}`}>
              <span className="v5-gutter">{l.n}</span>
              <span className="v5-diff-sign">{l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ' '}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="v5-diff-cols">
          <div className="v5-diff-col">
            <div className="v5-diff-col-h">До</div>
            <div className="v5-diff-line is-ctx">
              <span className="v5-gutter">14</span>
              <span>.dl-frame {'{'}</span>
            </div>
            <div className="v5-diff-line is-del">
              <span className="v5-gutter">15</span>
              <span>background: surface;</span>
            </div>
            <div className="v5-diff-line is-ctx">
              <span className="v5-gutter">16</span>
              <span>{'}'}</span>
            </div>
          </div>
          <div className="v5-diff-col">
            <div className="v5-diff-col-h">После</div>
            <div className="v5-diff-line is-ctx">
              <span className="v5-gutter">14</span>
              <span>.dl-frame {'{'}</span>
            </div>
            <div className="v5-diff-line is-add">
              <span className="v5-gutter">15</span>
              <span>background: window;</span>
            </div>
            <div className="v5-diff-line is-add">
              <span className="v5-gutter">16</span>
              <span>border: 1px solid;</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── 25–28: настройки и ресурсы ────────────────────────────────────── */

function SettingCell() {
  const [startCollapsed, setStartCollapsed] = useState(true);
  const [theme, setTheme] = useState('dark');
  const [pause, setPause] = useState(30);
  return (
    <div className="v5-stack">
      <div className="v5-set-row">
        <div className="v5-set-txt">
          <div className="v5-srow-label">Сворачивать панель при старте</div>
          <div className="v5-srow-desc">Запоминается для профиля Windows</div>
        </div>
        <Switch checked={startCollapsed} onChange={setStartCollapsed} label="Сворачивать панель при старте" />
      </div>
      <div className="v5-set-row">
        <div className="v5-set-txt">
          <div className="v5-srow-label">Тема новых окон</div>
          <div className="v5-srow-desc">Не меняет открытые окна</div>
        </div>
        <select className="v5-nselect" value={theme} aria-label="Тема новых окон" onChange={(e) => setTheme(e.target.value)}>
          <option value="dark">Тёмная</option>
          <option value="light">Светлая</option>
          <option value="system">Системная</option>
        </select>
      </div>
      <div className="v5-set-row">
        <div className="v5-set-txt">
          <div className="v5-srow-label">Пауза автосохранения</div>
          <div className="v5-srow-desc">Черновик после паузы ввода</div>
        </div>
        <span className="v5-set-num">
          <input
            className="v5-num"
            type="number"
            min={5}
            max={120}
            step={5}
            value={pause}
            aria-label="Пауза автосохранения, секунды"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setPause(Math.min(120, Math.max(5, n)));
            }}
          />
          с
        </span>
      </div>
    </div>
  );
}

function ThemeCell() {
  const DEFAULTS: Record<string, { bg: string; accent: string; text: string }> = {
    dark: { bg: '#20221F', accent: '#78957C', text: '#E5E7E2' },
    light: { bg: '#FAF9F6', accent: '#65816D', text: '#20211F' },
    claude: { bg: '#F4F1EA', accent: '#B85C38', text: '#2B2A26' },
  };
  const [preset, setPreset] = useState('dark');
  const [draft, setDraft] = useState(DEFAULTS.dark);
  const [saved, setSaved] = useState(false);
  const pick = (id: string) => {
    setPreset(id);
    setDraft(DEFAULTS[id]);
    setSaved(false);
  };
  return (
    <div className="v5-stack">
      <Seg
        label="Пресет темы"
        value={preset}
        onChange={pick}
        options={[
          { id: 'dark', label: 'Тёмная' },
          { id: 'light', label: 'Светлая' },
          { id: 'claude', label: 'Claude' },
        ]}
      />
      <div className="v5-theme-tokens">
        {(
          [
            ['Фон', 'bg'],
            ['Акцент', 'accent'],
            ['Текст', 'text'],
          ] as const
        ).map(([label, key]) => (
          <label key={key} className="v5-theme-row">
            <span className="v5-swatch" style={{ background: draft[key] }}>
              <input
                type="color"
                value={draft[key]}
                aria-label={`Цвет: ${label}`}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, [key]: e.target.value }));
                  setSaved(false);
                }}
              />
            </span>
            <span className="v5-theme-lbl">{label}</span>
            <code>{draft[key]}</code>
          </label>
        ))}
      </div>
      <div className="v5-theme-prev" style={{ background: draft.bg, color: draft.text }}>
        <span style={{ background: draft.accent }}>Aa</span>
        Предпросмотр до сохранения
      </div>
      <div className="v5-row-between">
        <span className="v5-cap">{saved ? 'Черновик сохранён (fixture)' : 'Есть несохранённые правки'}</span>
        <span className="v5-row-actions">
          <button
            type="button"
            className="v5-btn ghost"
            onClick={() => {
              setDraft(DEFAULTS[preset]);
              setSaved(false);
            }}
          >
            Отмена
          </button>
          <button type="button" className="v5-btn" disabled={!saved && draft.bg === DEFAULTS[preset].bg && draft.accent === DEFAULTS[preset].accent && draft.text === DEFAULTS[preset].text} onClick={() => setSaved(true)}>
            Сохранить
          </button>
        </span>
      </div>
    </div>
  );
}

function RuntimeCell() {
  const CHECKS = [
    { id: 'wsl', name: 'WSL 2', detail: 'Ubuntu 24.04', tone: 'ok' as const },
    { id: 'pi', name: 'Pi CLI', detail: '1.4.0', tone: 'ok' as const },
    { id: 'node', name: 'Node.js', detail: '20.11.1', tone: 'ok' as const },
    { id: 'disk', name: 'Свободно на диске', detail: '1,2 ГБ', tone: 'warn' as const },
  ];
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState('14:02');
  const probe = () => {
    if (checking) return;
    setChecking(true);
    window.setTimeout(() => {
      setChecking(false);
      setCheckedAt('только что');
    }, 700);
  };
  return (
    <div className="v5-stack">
      <div className="v5-row-between">
        <span className="v5-cap">Проверено: {checkedAt}</span>
        <button type="button" className="v5-btn" aria-busy={checking} disabled={checking} onClick={probe}>
          {checking ? 'Проверяем…' : 'Проверить снова'}
        </button>
      </div>
      {CHECKS.map((c) => (
        <div key={c.id} className="v5-run-row">
          <span className={c.tone === 'ok' ? 'is-ok' : 'is-warn'}>
            {checking ? <span className="v5-spin" /> : c.tone === 'ok' ? <IconCheckCircle size={14} /> : <WarnGlyph />}
          </span>
          <span className="v5-run-name">{c.name}</span>
          <span className="v5-cap">{checking ? 'проверка…' : c.detail}</span>
          <span className={c.tone === 'ok' ? 'v5-run-res is-ok' : 'v5-run-res is-warn'}>
            {checking ? '—' : c.tone === 'ok' ? 'готово' : 'мало места'}
          </span>
        </div>
      ))}
    </div>
  );
}

function ResourceCell() {
  type Kind = 'skill' | 'extension' | 'mcp' | 'module';
  const DATA: Record<Kind, { icon: ReactNode; title: string; desc: string; meta: string }> = {
    skill: {
      icon: <IconBookDoc size={16} />,
      title: 'pi-desktop-status',
      desc: 'Восстановление состояния проекта из GitHub',
      meta: 'scope: global · v1.3',
    },
    extension: {
      icon: <IconPuzzle size={16} />,
      title: 'design-lab',
      desc: 'Изолированная визуальная лаборатория Issue #21',
      meta: 'renderer · dev-only',
    },
    mcp: {
      icon: <IconDatabase size={16} />,
      title: 'context7',
      desc: 'Актуальная документация библиотек по запросу',
      meta: 'tools: 2 · локальный',
    },
    module: {
      icon: <IconGear size={16} />,
      title: 'resources',
      desc: 'Декларативный discovery и persistence (M3)',
      meta: 'enabled · scope: project',
    },
  };
  const [kind, setKind] = useState<Kind>('skill');
  const [enabled, setEnabled] = useState(true);
  const d = DATA[kind];
  return (
    <div className="v5-stack">
      <Seg
        label="Вид ресурса"
        value={kind}
        onChange={(k) => setKind(k as Kind)}
        options={[
          { id: 'skill', label: 'Skill' },
          { id: 'extension', label: 'Extension' },
          { id: 'mcp', label: 'MCP' },
          { id: 'module', label: 'Module' },
        ]}
      />
      <div className="v5-res-card">
        <span className="v5-res-icon">{d.icon}</span>
        <div className="v5-res-txt">
          <div className="v5-srow-label">{d.title}</div>
          <div className="v5-srow-desc">{d.desc}</div>
          <div className="v5-res-meta">
            <span>{d.meta}</span>
            <span className={enabled ? 'v5-run-res is-ok' : 'v5-run-res is-idle'}>{enabled ? 'Здоров' : 'Отключён'}</span>
          </div>
        </div>
        <div className="v5-res-actions">
          <Switch checked={enabled} onChange={setEnabled} label={`Включить ${d.title}`} />
          <button type="button" className="v5-iconbtn" aria-label={`Действия: ${d.title}`}>
            <IconDots size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 29–32: данные ─────────────────────────────────────────────────── */

function MetricsCell() {
  const metrics = [
    { label: 'Сессии', value: '128', qual: 'за 7 дней', helper: '+12 к прошлой неделе' },
    { label: 'Токены', value: '1,2M', qual: 'оценка ±10%', helper: 'по активным моделям' },
    { label: 'Запросы', value: '984', qual: 'модель', helper: 'без платных prompt' },
    { label: 'Стоимость', value: '—', qual: 'нет данных', helper: 'покрытие 0%' },
  ];
  return (
    <div className="v5-metrics">
      {metrics.map((m) => (
        <div key={m.label} className="v5-metric">
          <span className="v5-cap">{m.label}</span>
          <b className={m.value === '—' ? 'is-unknown' : ''}>{m.value}</b>
          <span className="v5-metric-qual">{m.qual}</span>
          <span className="v5-cap">{m.helper}</span>
        </div>
      ))}
    </div>
  );
}

function ChartCell() {
  const [mode, setMode] = useState('line');
  const days = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const vals = [4, 7, 5, 9, 6, 8, 11];
  const max = 12;
  const stacked = [
    [2, 1, 1],
    [3, 2, 2],
    [2, 2, 1],
    [4, 3, 2],
    [2, 2, 2],
    [3, 3, 2],
    [5, 4, 2],
  ];
  const pts = vals.map((v, i) => `${(i * 240) / 6},${60 - (v / max) * 52}`).join(' ');
  return (
    <div className="v5-stack">
      <Seg
        label="Вид графика"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'line', label: 'Запросы' },
          { id: 'stacked', label: 'Состав' },
        ]}
      />
      {mode === 'line' ? (
        <div className="v5-chart">
          <div className="v5-chart-plot">
            <svg viewBox="0 0 240 64" preserveAspectRatio="none" role="img" aria-label="Запросы по дням: 4, 7, 5, 9, 6, 8, 11">
              <line x1="0" y1="60" x2="240" y2="60" className="axis" />
              <line x1="0" y1="8" x2="240" y2="8" className="grid" />
              <polyline points={pts} className="line" />
            </svg>
            {vals.map((v, i) => (
              <i
                key={days[i]}
                className="v5-dot"
                style={{ left: `${(i * 100) / 6}%`, bottom: `${((4 + (v / max) * 52) / 64) * 100}%` }}
                title={`${days[i]}: ${v}`}
              />
            ))}
          </div>
          <div className="v5-chart-x">
            {days.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="v5-chart">
          <div className="v5-bars">
            {stacked.map((parts, i) => (
              <span key={days[i]} className="v5-bar-col" title={`${days[i]}: ${parts[0] + parts[1] + parts[2]}`}>
                <i className="t-c" style={{ height: `${parts[2] * 5}px` }} />
                <i className="t-b" style={{ height: `${parts[1] * 5}px` }} />
                <i className="t-a" style={{ height: `${parts[0] * 5}px` }} />
              </span>
            ))}
          </div>
          <div className="v5-chart-x">
            {days.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
      )}
      <div className="v5-legend">
        {mode === 'line' ? (
          <span>
            <i className="dot t-a" /> Запросы · пик 11 (вс)
          </span>
        ) : (
          <>
            <span>
              <i className="dot t-a" /> Система
            </span>
            <span>
              <i className="dot t-b" /> Инструменты
            </span>
            <span>
              <i className="dot t-c" /> Диалог
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function HeatmapCell() {
  const values = [
    0, 1, 2, 1, 3, 0, 0, 1, 2, 4, 2, 1, 0, 0, 2, 3, 2, 2, 1, 0, 0, 1, 4, 3, 2, 0, 1, 0,
  ];
  const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const level = (l: number) =>
    l === 0
      ? 'var(--pw-code-background-color)'
      : `color-mix(in srgb, var(--pw-accent-color) ${l * 24}%, var(--pw-code-background-color))`;
  return (
    <div className="v5-stack">
      <div className="v5-hm-head">
        {weekdays.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="v5-hm-grid">
        {values.map((v, i) => (
          <span
            key={`d${i + 1}`}
            className="v5-hm-c"
            style={{ background: level(v) }}
            title={`Неделя ${Math.floor(i / 7) + 1}, день ${(i % 7) + 1}: ${v} сессий`}
          />
        ))}
      </div>
      <div className="v5-legend v5-hm-legend">
        <span className="v5-cap">нет</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} style={{ background: level(l) }} />
        ))}
        <span className="v5-cap">4+</span>
      </div>
    </div>
  );
}

function TableCell() {
  type Row = { id: string; name: string; model: string; tokens: number; time: string };
  const rows: Row[] = [
    { id: 's1', name: 'ui-fidelity-r03', model: 'MiMo v2.6', tokens: 84200, time: '14:31' },
    { id: 's2', name: 'm4-packaging', model: 'GPT-5.2', tokens: 39100, time: '12:08' },
    { id: 's3', name: 'd1-design-lab', model: 'MiMo v2.6', tokens: 120400, time: '09:47' },
    { id: 's4', name: 'm3-discovery', model: 'Claude 4.7', tokens: 55600, time: 'вчера' },
  ];
  const [sort, setSort] = useState<{ col: 'tokens' | 'time'; dir: 'asc' | 'desc' }>({ col: 'tokens', dir: 'desc' });
  const sorted = [...rows].sort((a, b) => {
    const v = sort.col === 'tokens' ? a.tokens - b.tokens : a.time.localeCompare(b.time);
    return sort.dir === 'asc' ? v : -v;
  });
  const toggle = (col: 'tokens' | 'time') =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }));
  const arrow = (col: 'tokens' | 'time') => (sort.col === col ? (sort.dir === 'asc' ? '↑' : '↓') : '');
  return (
    <table className="v5-table">
      <thead>
        <tr>
          <th scope="col">Сессия</th>
          <th scope="col">Модель</th>
          <th scope="col" className="num" aria-sort={sort.col === 'tokens' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" onClick={() => toggle('tokens')}>
              Токены {arrow('tokens')}
            </button>
          </th>
          <th scope="col" className="num" aria-sort={sort.col === 'time' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" onClick={() => toggle('time')}>
              Время {arrow('time')}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td className="muted">{r.model}</td>
            <td className="num">{r.tokens.toLocaleString('ru-RU')}</td>
            <td className="num muted">{r.time}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── 33–36: обратная связь ─────────────────────────────────────────── */

function AlertCell() {
  const alerts: { tone: string; icon: ReactNode; title: string; msg: string; action: string }[] = [
    {
      tone: 'info',
      icon: <IconInfo size={14} />,
      title: 'Подключение к Pi',
      msg: 'Bridge не запущен — показан кэш последних сессий.',
      action: 'Повторить',
    },
    {
      tone: 'warn',
      icon: <WarnGlyph />,
      title: 'Диск почти заполнен',
      msg: 'На диске C осталось 1,2 ГБ — установка может не завершиться.',
      action: 'Настройки',
    },
    {
      tone: 'error',
      icon: <ErrGlyph />,
      title: 'Установка не удалась',
      msg: 'NSIS вернул код 1 — подробности в журнале.',
      action: 'Журнал',
    },
  ];
  return (
    <div className="v5-stack v5-tight">
      {alerts.map((a) => (
        <div key={a.tone} className={`v5-alert is-${a.tone}`}>
          <span className="v5-alert-icon">{a.icon}</span>
          <div className="v5-alert-txt">
            <b>{a.title}</b>
            <span>{a.msg}</span>
          </div>
          <button type="button" className="v5-link">
            {a.action}
          </button>
        </div>
      ))}
    </div>
  );
}

function ToastCell() {
  type T = { id: string; msg: string; undone?: boolean; undoable?: boolean };
  const INITIAL: T[] = [
    { id: 't1', msg: 'Настройки сохранены' },
    { id: 't2', msg: 'Сессия переименована', undoable: true },
  ];
  const [toasts, setToasts] = useState<T[]>(INITIAL);
  return (
    <div className="v5-stack">
      {toasts.map((t) => (
        <div key={t.id} className={t.undone ? 'v5-toast is-undone' : 'v5-toast'}>
          <span className="v5-toast-icon">{t.undone ? <IconInfo size={14} /> : <IconCheckCircle size={14} />}</span>
          <span className="v5-toast-msg">{t.undone ? `Отменено: ${t.msg}` : t.msg}</span>
          {t.undoable && !t.undone && (
            <button type="button" className="v5-link" onClick={() => setToasts((list) => list.map((x) => (x.id === t.id ? { ...x, undone: true } : x)))}>
              Отменить
            </button>
          )}
          <button type="button" className="v5-att-x" aria-label={`Закрыть: ${t.msg}`} onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>
            <IconClose size={13} />
          </button>
        </div>
      ))}
      <div className="v5-row-between">
        <span className="v5-cap">{toasts.length} из {INITIAL.length} активных</span>
        <button type="button" className="v5-btn" onClick={() => setToasts(INITIAL)}>
          Показать снова
        </button>
      </div>
    </div>
  );
}

function ModalCell() {
  // Ячейка показывает диалог всегда (fixture = утверждённый вид), но модальным
  // он становится только после явного открытия: иначе один только переход на
  // board забирал бы фокус в нижнюю ячейку и запирал Tab.
  const [closed, setClosed] = useState(false);
  const [activated, setActivated] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const modal = activated && !closed;

  useEffect(() => {
    if (!modal) return;
    firstActionRef.current?.focus();
  }, [modal]);

  /* Закрытие всегда возвращает фокус на кнопку повторного открытия: иначе
   * подпись «фокус вернулся» была бы ложью для закрытия из превью. */
  const close = () => {
    setClosed(true);
    window.setTimeout(() => reopenRef.current?.focus(), 0);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!modal) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusables || focusables.length === 0) return;
    const list = [...focusables];
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="v5-modal-frame">
      {closed ? (
        <div className="v5-modal-closed">
          <span className="v5-cap">Диалог закрыт, фокус на кнопке открытия (fixture)</span>
          <button
            type="button"
            ref={reopenRef}
            className="v5-btn"
            onClick={() => {
              setActivated(true);
              setClosed(false);
            }}
          >
            Открыть снова
          </button>
        </div>
      ) : (
        <div
          className="v5-modal"
          role="dialog"
          aria-label="Удалить сессию?"
          {...(modal ? { 'aria-modal': true } : {})}
          ref={dialogRef}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            // Клик по действиям/крестику не должен «активировать» модальность:
            // иначе закрытие из превью молча включало модальный режим.
            if ((event.target as Element).closest('.v5-modal-actions, .v5-att-x')) return;
            setActivated(true);
          }}
        >
          <div className="v5-modal-h">
            <b>Удалить сессию?</b>
            <button type="button" className="v5-att-x" aria-label="Закрыть диалог" onClick={close}>
              <IconClose size={13} />
            </button>
          </div>
          <p className="v5-modal-body">Сессия «логи от 12 октября» будет удалена без возможности восстановления.</p>
          <div className="v5-modal-actions">
            <button type="button" ref={firstActionRef} className="v5-btn ghost" onClick={close}>
              Отмена
            </button>
            <button type="button" className="v5-btn danger" onClick={close}>
              Удалить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyCell() {
  const reasons: Record<string, { icon: ReactNode; title: string; desc: string; action: string }> = {
    data: {
      icon: <IconChatBubble size={18} />,
      title: 'Пока нет сессий',
      desc: 'Сессии Pi появятся после первого подключения.',
      action: 'Новый диалог',
    },
    search: {
      icon: <IconSearch size={18} />,
      title: 'Ничего не найдено',
      desc: 'Измените запрос или снимите фильтры источника.',
      action: 'Сбросить фильтры',
    },
    conn: {
      icon: <IconMonitor size={18} />,
      title: 'WSL недоступна',
      desc: 'Проверьте установку WSL и повторите попытку.',
      action: 'Проверить снова',
    },
  };
  const [reason, setReason] = useState('search');
  const r = reasons[reason];
  return (
    <div className="v5-stack">
      <Seg
        label="Причина пустого состояния"
        value={reason}
        onChange={setReason}
        options={[
          { id: 'data', label: 'Нет данных' },
          { id: 'search', label: 'Нет совпадений' },
          { id: 'conn', label: 'Нет связи' },
        ]}
      />
      <div className="v5-empty">
        <span className="v5-empty-icon">{r.icon}</span>
        <b>{r.title}</b>
        <span className="v5-cap">{r.desc}</span>
        <button type="button" className="v5-btn">
          {r.action}
        </button>
      </div>
    </div>
  );
}
