/**
 * Design Lab — точка входа (Issue #21, D1).
 *
 * Изолированный Vite dev-server: React + CSS-слой БЕЗ Electron, Pi, WSL Bridge,
 * IPC и user ~/.pi. Данные состояний — только fixtures.tsx (DEMO).
 * Выбор состояния: ?state=ref1..ref6 | settings | demo | board | app | showcase; ?bare=1 скрывает
 * picker (используется скриптом capture.mjs для чистых скриншотов).
 * app (D1-этап 2): ?state=app&variant=a|b — геометрические альтернативы
 * IMPLEMENTATION-PROMPT (44/28/260/340) и DESIGN-UPDATE v3 (36/26/240/360).
 */
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/renderer/design/typography.css';
import '../src/renderer/design/layout.css';
import '../src/renderer/design/components.css';
import '../src/renderer/design/board.css';
// D2: маркер лабы — общий CSS отдаёт ей прежний визуальный адаптив
// (панели скрыты в стеснённых видах), а продукту — overlay/rail-стратегию.
document.documentElement.dataset.designLab = '1';
import { applyTheme } from '../src/renderer/design/applyTheme';
import { applyTypography } from '../src/renderer/design/applyTypography';
import { defaultTypography } from '../src/shared/appearance';
import { THEME_PRESETS, type ThemePresetId } from '../src/shared/design/presets';
import { AppFrame } from '../src/renderer/ui/AppFrame';
import { AppScreenLab as AppScreen, type AppVariant } from './AppScreen';
import { EmptyChatScreen, ModulesScreen, Showcase, type ShowcaseSection } from './Showcase';
import { BoardScreen } from '../src/renderer/ui/BoardScreen';
import { ChatView } from '../src/renderer/ui/ChatView';
import { DetailsHeader, DetailsPanel } from '../src/renderer/ui/DetailsPanel';
import { Rail } from '../src/renderer/ui/Rail';
import { ResourcesScreen } from '../src/renderer/ui/ResourcesScreen';
import { SettingsScreen } from '../src/renderer/ui/SettingsScreen';
import { Sidebar } from '../src/renderer/ui/Sidebar';
import { StatusBar } from '../src/renderer/ui/StatusBar';
import { TerminalPane } from '../src/renderer/ui/TerminalPane';
import { IconDots, IconPanelExpand } from '../src/renderer/ui/icons';
import * as F from './fixtures';

const STATES = ['ref1', 'ref2', 'ref3', 'ref4', 'ref5', 'ref6', 'settings', 'demo', 'board', 'app', 'showcase'] as const;
type StateId = (typeof STATES)[number];

interface StateView {
  label: string;
  theme: ThemePresetId;
  node: ReactNode;
}

function sidebar(activeSessionId: string | undefined, navActive: string | undefined) {
  return (
    <Sidebar
      projects={F.SIDEBAR_PROJECTS}
      nav={F.SIDEBAR_NAV.map((item) => ({ ...item, active: item.id === navActive }))}
      activeSessionId={activeSessionId}
      connection={F.CONNECTION}
    />
  );
}

function rail(tooltip: string | undefined) {
  return <Rail top={F.RAIL_TOP} bottom={F.RAIL_BOTTOM} tooltip={tooltip} />;
}

function chatTurns(markdown: boolean) {
  return markdown ? F.TURNS_MARKDOWN : F.TURNS_DONE;
}

function buildState(state: StateId): StateView {
  switch (state) {
    case 'ref1':
      return {
        label: 'ref1 · тёмный, rail + Детали',
        theme: 'dark',
        node: (
          <AppFrame
            layout="split"
            theme="dark"
            side={rail('Показать проекты')}
            breadcrumb={F.BREADCRUMB_CHAT}
            railToggle={
              <button type="button" className="dl-rail-toggle" aria-label="Показать проекты">
                <IconPanelExpand size={22} />
              </button>
            }
            toolbarActions={
              <>
                <button type="button" className="dl-btn-ghost dl-toolbar-dots" aria-label="Ещё действия">
                  <IconDots size={19} />
                </button>
                <button type="button" className="dl-btn-accent dl-toolbar-expand" aria-label="Развернуть список">
                  <IconPanelExpand size={22} />
                </button>
              </>
            }
            details={{ header: <DetailsHeader title="Детали действия" />, body: <DetailsPanel {...F.DETAILS_DATA} /> }}
          >
            <ChatView turns={F.TURNS_ACTIVE} composer={{  density: 'standard', context: 'Контекст 18%', model: 'MiMo v2.6' }} stepCircle={32} />
          </AppFrame>
        ),
      };
    case 'ref2':
      return {
        label: 'ref2 · тёмный, sidebar, чат',
        theme: 'dark',
        node: (
          <AppFrame layout="inline" theme="dark" side={sidebar('search-history', undefined)} breadcrumb={F.BREADCRUMB_CHAT}>
            <ChatView
              header={
                <button type="button" className="dl-btn-ghost dl-btn-dots" aria-label="Ещё действия">
                  <IconDots size={19} />
                </button>
              }
              turns={chatTurns(false)}
              composer={{  density: 'relaxed', context: 'Контекст 18%', model: 'MiMo v2.6' }}
              hint={F.HINT}
              stepCircle={24}
            />
          </AppFrame>
        ),
      };
    case 'ref3':
      return {
        label: 'ref3 · тёмный, Ресурсы',
        theme: 'dark',
        node: (
          <AppFrame layout="inline" theme="dark" side={sidebar(undefined, 'resources')} breadcrumb={F.BREADCRUMB_RESOURCES}>
            <ResourcesScreen
              tabs={F.RESOURCE_TABS}
              meta={F.RESOURCE_META}
              rows={F.SKILLS}
              note={F.RESOURCE_NOTE}
            />
          </AppFrame>
        ),
      };
    case 'ref4':
      return {
        label: 'ref4 · СВЕТЛЫЙ, sidebar, чат',
        theme: 'light',
        node: (
          <AppFrame layout="inline" theme="light" side={sidebar('search-history', undefined)} breadcrumb={F.BREADCRUMB_CHAT}>
            <ChatView
              header={
                <button type="button" className="dl-btn-ghost dl-btn-dots" aria-label="Ещё действия">
                  <IconDots size={19} />
                </button>
              }
              turns={chatTurns(false)}
              composer={{  density: 'relaxed', context: 'Контекст 18%', model: 'MiMo v2.6' }}
              hint={F.HINT}
              stepCircle={24}
            />
          </AppFrame>
        ),
      };
    case 'ref5':
      return {
        label: 'ref5 · тёмный, терминал + статус-бар',
        theme: 'dark',
        node: (
          <AppFrame
            layout="split"
            theme="dark"
            side={rail(undefined)}
            breadcrumb={F.BREADCRUMB_CHAT}
            railToggle={
              <button type="button" className="dl-rail-toggle" aria-label="Показать проекты">
                <IconPanelExpand size={22} />
              </button>
            }
            toolbarActions={
              <>
                <button type="button" className="dl-btn-ghost dl-toolbar-dots" aria-label="Ещё действия">
                  <IconDots size={19} />
                </button>
                <button type="button" className="dl-btn-accent dl-toolbar-expand" aria-label="Развернуть список">
                  <IconPanelExpand size={22} />
                </button>
              </>
            }
            details={{ header: <DetailsHeader title="Детали действия" />, body: <DetailsPanel {...F.DETAILS_DATA} /> }}
            statusBar={
              <StatusBar
                connection={{ label: 'Pi подключён' }}
                distro="Ubuntu · WSL"
                right={F.STATUS_RIGHT}
                terminalLabel="Терминал"
              />
            }
            terminal
          >
            <ChatView
              turns={F.TURNS_ACTIVE}
              composer={{  density: 'compact', context: 'Контекст 18%', model: 'MiMo v2.6' }}
              stepCircle={32}
              showIdentity={false}
              terminal={<TerminalPane tabs={F.TERMINAL_TABS} lines={F.TERMINAL_LINES} />}
            />
          </AppFrame>
        ),
      };
    case 'ref6':
      return {
        label: 'ref6 · СВЕТЛЫЙ, Ресурсы',
        theme: 'light',
        node: (
          <AppFrame layout="inline" theme="light" side={sidebar(undefined, 'resources')} breadcrumb={F.BREADCRUMB_RESOURCES}>
            <ResourcesScreen
              tabs={F.RESOURCE_TABS}
              meta={F.RESOURCE_META}
              rows={F.SKILLS}
              note={F.RESOURCE_NOTE}
            />
          </AppFrame>
        ),
      };
    case 'settings':
      return {
        label: 'settings · Настройки (БЕЗ эталона)',
        theme: 'dark',
        node: (
          <AppFrame layout="inline" theme="dark" side={sidebar(undefined, 'settings')} breadcrumb={<span>Настройки</span>}>
            <SettingsScreen activeThemeId="dark" connection={F.CONNECTION} />
          </AppFrame>
        ),
      };
    case 'demo':
      return {
        label: 'demo · Markdown-тело (БЕЗ эталона)',
        theme: 'dark',
        node: (
          <AppFrame layout="inline" theme="dark" side={sidebar('search-history', undefined)} breadcrumb={F.BREADCRUMB_CHAT}>
            <ChatView
              header={
                <button type="button" className="dl-btn-ghost dl-btn-dots" aria-label="Ещё действия">
                  <IconDots size={19} />
                </button>
              }
              turns={chatTurns(true)}
              composer={{  density: 'relaxed', context: 'Контекст 18%', model: 'MiMo v2.6' }}
              hint={F.HINT}
              stepCircle={24}
            />
          </AppFrame>
        ),
      };
    case 'board':
      return {
        label: 'board · Компоненты (01–09)',
        theme: 'dark',
        node: <BoardScreen />,
      };
    case 'app': {
      const variantRaw = params.get('variant');
      const variant: AppVariant | undefined = variantRaw === 'a' || variantRaw === 'b' ? variantRaw : undefined;
      return {
        label: variant ? `app · Главный экран · вариант ${variant.toUpperCase()}` : 'app · Главный экран (01-chat-review-terminal)',
        theme: 'dark',
        node: <AppScreen variant={variant} />,
      };
    }
    case 'showcase': {
      // Витрина всего продукта: готовые экраны picker-состояний + два
      // самостоятельных (пустой диалог, реестр модулей) — все на фикстурах.
      const sections: ShowcaseSection[] = [
        {
          title: 'Главный экран',
          hint: 'сайдбар, диалог, панель изменений, терминал, статус-бар',
          node: buildState('app').node,
        },
        {
          title: 'Диалог: пустое состояние',
          hint: 'честный старт без открытой сессии',
          node: <EmptyChatScreen />,
        },
        {
          title: 'Диалог: активное действие',
          hint: 'детали действия, шаги, композер',
          node: buildState('ref1').node,
        },
        {
          title: 'Диалог: готовый ответ',
          hint: 'Markdown-тело и подсказки ввода',
          node: buildState('demo').node,
        },
        { title: 'Ресурсы', hint: 'навыки и установка', node: buildState('ref3').node },
        {
          title: 'Модули',
          hint: 'реестр M3: включение, блокировки, ошибки',
          node: <ModulesScreen />,
        },
        {
          title: 'Настройки',
          hint: 'тема, типографика, подключение',
          node: buildState('settings').node,
        },
        {
          title: 'Терминал и статус-бар',
          hint: 'док терминала и честные метрики',
          node: buildState('ref5').node,
        },
        {
          title: 'Светлая тема',
          hint: 'тот же экран в light-пресете',
          node: buildState('ref4').node,
          light: true,
        },
        {
          title: 'Библиотека компонентов',
          hint: 'board 01–36 (скролл внутри рамки)',
          node: buildState('board').node,
          scroll: true,
        },
      ];
      return {
        label: 'showcase · Весь продукт на фикстурах',
        theme: 'dark',
        node: <Showcase sections={sections} />,
      };
    }
  }
}

function Picker({ current }: { current: StateId }) {
  return (
    <nav
      className="dl-lab-picker"
      aria-label="Состояния Design Lab (DEMO)"
      style={{
        position: 'fixed',
        right: 14,
        bottom: 12,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
        background: 'var(--pw-tool-card-background-color)',
        border: '1px solid var(--pw-divider-color)',
        borderRadius: 'var(--pw-radius-medium)',
        fontFamily: 'var(--dl-font-stack)',
        fontSize: 13,
        color: 'var(--pw-muted-text-color)',
      }}
    >
      <span style={{ fontWeight: 700, color: 'var(--pw-warning-color)' }}>DEMO · Design Lab</span>
      {STATES.map((id) => (
        <a
          key={id}
          href={`?state=${id}`}
          style={{
            color: id === current ? 'var(--pw-accent-text-color)' : 'var(--pw-body-text-color)',
            background: id === current ? 'var(--pw-accent-color)' : 'transparent',
            textDecoration: 'none',
            padding: '2px 7px',
            borderRadius: 'var(--pw-radius-small)',
          }}
        >
          {id}
        </a>
      ))}
    </nav>
  );
}

const params = new URLSearchParams(window.location.search);
const rawState = params.get('state') ?? 'ref2';
const state: StateId = (STATES as readonly string[]).includes(rawState) ? (rawState as StateId) : 'ref2';
const bare = params.get('bare') === '1';

const view = buildState(state);
const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root not found');
}
applyTheme(rootEl, THEME_PRESETS[view.theme].tokens);
applyTypography(rootEl, defaultTypography());

createRoot(rootEl).render(
  <StrictMode>
    {view.node}
    {bare ? null : <Picker current={state} />}
  </StrictMode>,
);
