/**
 * Design Lab — детерминированные иллюстративные фикстуры (Issue #21, D1).
 *
 * Данные воспроизводят шесть эталонных мокапов дословно (тексты, навыки,
 * шаги ответа, строки терминала). Никаких данных Pi/WSL/IPC здесь нет:
 * это DEMO-контент для предпросмотра; реальная интеграция — позже (D2/D3).
 * Значения CPU/RAM в статус-баре — иллюстративные (DEMO), не реальные метрики.
 */
import type { ReactNode } from 'react';
import { SafeMarkdown } from '../src/renderer/SafeMarkdown';
import type { ChatTurn, ChatStep } from '../src/renderer/ui/ChatView';
import type { SidebarNavItem, SidebarProject } from '../src/renderer/ui/Sidebar';
import type { SkillRow } from '../src/renderer/ui/ResourcesScreen';
import type { StatusItem } from '../src/renderer/ui/StatusBar';
import {
  IconBookDoc,
  IconBulb,
  IconCode,
  IconCopy,
  IconCpu,
  IconDatabase,
  IconGear,
  IconMemory,
  IconMonitor,
  IconPuzzle,
  IconRefresh,
  IconTerminalGlyph,
  IconShield,
} from '../src/renderer/ui/icons';

export const USER_TEXT = 'Добавь поиск по истории диалогов. Хочу находить нужный чат по названию и тексту.';

const ASSIST_MD =
  'Добавлю поиск в боковую панель. Он будет находить диалоги по названию и содержимому.';

export const BULLETS = [
  'Поиск обновляется по мере ввода',
  'Совпадения подсвечиваются в результатах',
  'История диалогов сохранена',
];

const CHAT_ACTIONS = [
  { id: 'copy', label: 'Скопировать ответ', icon: <IconCopy size={19} /> },
  { id: 'retry', label: 'Попробовать ещё раз', icon: <IconRefresh size={19} /> },
];

function steps(active: boolean): ChatStep[] {
  return [
    { id: 's1', text: 'Изучены 4 файла' },
    { id: 's2', text: 'Добавлен поиск по истории', ...(active ? { active: true, more: 'Подробнее' } : {}) },
    { id: 's3', text: 'Проверки пройдены' },
  ];
}

function assistantTurn(id: string, body: ReactNode, activeStep: boolean): ChatTurn {
  return {
    kind: 'assistant',
    id,
    body,
    name: 'Pi',
    steps: steps(activeStep),
    heading: 'Готово',
    bullets: BULLETS,
    actions: CHAT_ACTIONS,
  };
}

/** ref1/ref5: активный шаг подсвечен («Подробнее»). */
export const TURNS_ACTIVE: ChatTurn[] = [
  { kind: 'user', id: 'u1', text: USER_TEXT },
  assistantTurn('a1', <SafeMarkdown text={ASSIST_MD} />, true),
];

/** ref2/ref4: все шаги завершены, без подсветки. */
export const TURNS_DONE: ChatTurn[] = [
  { kind: 'user', id: 'u1', text: USER_TEXT },
  assistantTurn('a1', <SafeMarkdown text={ASSIST_MD} />, false),
];

/** Дополнительное состояние demo-md — демонстрация Markdown-тела (без эталона). */
const DEMO_MD =
  'Подключаю `sessionSearch` к истории: поиск идёт по названию и содержимому диалога.\n\n' +
  '```\nnpm run test\n✓ tests/sessionSearch.test.ts (8 passed)\n```';

export const TURNS_MARKDOWN: ChatTurn[] = [
  { kind: 'user', id: 'u1', text: 'Покажи итог тестов в Markdown.' },
  assistantTurn('a1', <SafeMarkdown text={DEMO_MD} />, false),
];

export const HINT = 'Enter — отправить · Shift + Enter — новая строка';

export const BREADCRUMB_CHAT: ReactNode = (
  <>
    <span className="dl-crumb-part">Pi Desktop</span>
    <span className="dl-crumb-sep">/</span>
    <span>Поиск по истории</span>
  </>
);

export const BREADCRUMB_RESOURCES: ReactNode = (
  <>
    <span className="dl-crumb-part">Ресурсы</span>
    <span className="dl-crumb-sep">/</span>
    <span>Skills</span>
  </>
);

export const SIDEBAR_PROJECTS: SidebarProject[] = [
  {
    id: 'pi-desktop',
    name: 'Pi Desktop',
    expanded: true,
    sessions: [
      { id: 'search-history', title: 'Поиск по истории' },
      { id: 'wsl-connection', title: 'Подключение к WSL' },
      { id: 'extensions-setup', title: 'Настройка расширений' },
    ],
  },
  { id: 'personal-site', name: 'Личный сайт' },
  { id: 'notes', name: 'Заметки' },
];

export const SIDEBAR_NAV: SidebarNavItem[] = [
  { id: 'resources', label: 'Ресурсы', icon: <IconDatabase size={24} /> },
  { id: 'modules', label: 'Модули', icon: <IconPuzzle size={24} /> },
  { id: 'settings', label: 'Настройки', icon: <IconGear size={24} /> },
];

export const CONNECTION = { label: 'Pi подключён', detail: 'Ubuntu · WSL' };

export const RAIL_TOP = [
  { id: 'logo', label: 'Pi WSL Desktop', icon: <span className="dl-rail-glyph">π</span> },
  { id: 'new-chat', label: 'Новый диалог', icon: <span style={{ display: 'flex' }}>{reactPlus(32, 2)}</span> },
  { id: 'search', label: 'Поиск чатов', icon: <span style={{ display: 'flex' }}>{reactSearch(28)}</span> },
];

export const RAIL_BOTTOM = [
  { id: 'resources', label: 'Ресурсы', icon: <IconDatabase size={25} /> },
  { id: 'modules', label: 'Модули', icon: <IconPuzzle size={24} /> },
  { id: 'settings', label: 'Настройки', icon: <IconGear size={25} /> },
];

export const SKILLS: SkillRow[] = [
  { id: 'brainstorming', title: 'brainstorming', desc: 'Помогает превратить идею в понятный план', badge: 'Глобальный', icon: <IconBulb size={30} /> },
  { id: 'systematic-debugging', title: 'systematic-debugging', desc: 'Находит причину ошибки до внесения изменений', badge: 'Глобальный', icon: <IconCode size={30} /> },
  { id: 'test-driven-development', title: 'test-driven-development', desc: 'Разработка через проверяемые тесты', badge: 'Глобальный', icon: <IconBookDoc size={30} /> },
  { id: 'pi-desktop-development', title: 'pi-desktop-development', desc: 'Правила разработки Pi WSL Desktop', badge: 'Проект Pi Desktop', icon: <IconMonitor size={30} /> },
  { id: 'pi-desktop-safety', title: 'pi-desktop-safety', desc: 'Безопасная работа с окружением и данными', badge: 'Проект Pi Desktop', icon: <IconShield size={30} /> },
  { id: 'context-compression', title: 'context-compression', desc: 'Сохраняет важные решения длинного диалога', badge: 'Глобальный', icon: <IconDatabase size={30} /> },
];

export const RESOURCE_TABS = [
  { id: 'skills', label: 'Skills', active: true },
  { id: 'extensions', label: 'Extensions' },
  { id: 'mcp', label: 'MCP' },
];

export const RESOURCE_META = '6 навыков · Ubuntu';
export const RESOURCE_NOTE = 'Изменения доступны и в Pi CLI';

/** Строки терминала — дословная расшифровка ref5 (иллюстрация, не реальный PTY). */
function prompt(): ReactNode {
  return (
    <>
      <span className="t-green">triag@ubuntu</span>
      <span className="t-blue">:~/projects/pi-wsl-desktop</span>
      <span>$ </span>
    </>
  );
}

export const TERMINAL_LINES: ReactNode[] = [
  <>{prompt()}npm run test</>,
  <span className="t-muted">&gt; pi-wsl-desktop test</span>,
  <span className="t-muted">&gt; vitest run</span>,
  '',
  (
    <>
      <span className="t-green">✓</span> tests/sessionSearch.test.ts (8 tests)
    </>
  ),
  (
    <>
      {'Test Files  '}
      <span className="t-green t-bold">1 passed</span> (1)
    </>
  ),
  (
    <>
      {'     Tests  '}
      <span className="t-green t-bold">8 passed</span> (8)
    </>
  ),
  (
    <>
      {prompt()}
      <span className="t-cursor" />
    </>
  ),
];

export const TERMINAL_TABS = [
  { id: 'title', label: 'Терминал', icon: <IconTerminalGlyph size={17} /> },
  { id: 'session', label: 'Ubuntu · bash', active: true, closable: true },
];

/** DEMO-метрики (иллюстрация мокапа; реальные значения — UI-B, здесь НЕТ). */
export const STATUS_RIGHT: StatusItem[] = [
  { id: 'os', text: 'Windows' },
  { id: 'cpu', text: 'CPU 12%', icon: <IconCpu size={15} /> },
  { id: 'ram', text: 'RAM 8,4 / 32 ГБ', icon: <IconMemory size={15} /> },
];

export const DETAILS_DATA = {
  tabs: [
    { id: 'overview', label: 'Обзор', active: true },
    { id: 'files', label: 'Файлы' },
  ],
  pill: 'Выполнено',
  title: 'Поиск по истории',
  subtitle: 'Диалоги находятся по названию и тексту.',
  filesLabel: 'Изменённые файлы',
  files: [
    { id: 'f1', name: 'SessionsView.tsx' },
    { id: 'f2', name: 'sessionSearch.ts' },
    { id: 'f3', name: 'sessionSearch.test.ts' },
  ],
  checksLabel: 'Проверки',
  checks: [
    { id: 'c1', text: 'Поиск по названию' },
    { id: 'c2', text: 'Поиск по содержимому' },
  ],
  footer: '3 файла · Все проверки пройдены',
};

/* Локальные SVG-обёртки, эквивалентные иконкам из src/renderer/ui/icons.tsx
 * (импорт в fixtures только для простоты читаемости массивов). */
function reactPlus(size: number, strokeWidth: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function reactSearch(size: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}
