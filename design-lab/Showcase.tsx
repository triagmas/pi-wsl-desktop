/**
 * Design Lab — «Витрина всего продукта» (?state=showcase).
 *
 * Одна вертикальная страница-обзор: все экраны и элементы приложения,
 * собранные из УТВЕРЖДЁННЫХ ui-компонентов на fixture-данных — без
 * Electron, Pi, WSL Bridge, IPC и user ~/.pi (Issue #21, D3-showcase).
 * Готовые экраны передаются снаружи (main.tsx), здесь — только раскладка
 * витрины и два самостоятельных экрана, которых нет в picker-состояниях
 * (пустой диалог и реестр модулей).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { applyTheme } from '../src/renderer/design/applyTheme';
import { THEME_PRESETS } from '../src/shared/design/presets';
import { ModulesView } from '../src/renderer/ModulesView';
import type { ModuleEntry } from '../src/renderer/modules/registry';
import { AppFrame } from '../src/renderer/ui/AppFrame';
import { ChatView } from '../src/renderer/ui/ChatView';
import { Sidebar } from '../src/renderer/ui/Sidebar';
import * as F from './fixtures';
import './showcase.css';

export interface ShowcaseSection {
  /** Подпись секции над рамкой-экраном. */
  title: string;
  /** Короткое пояснение справа от подписи. */
  hint?: string;
  node: ReactNode;
  /** Секция в светлой теме — локальный applyTheme на обёртке. */
  light?: boolean;
  /** Длинный экран (board) — скролл внутри рамки. */
  scroll?: boolean;
}

export function Showcase({ sections }: { sections: ShowcaseSection[] }) {
  const lightRef = useRef<HTMLDivElement>(null);
  // Локальная светлая тема секции: прямая запись CSS-переменных (не state).
  useLayoutEffect(() => {
    if (lightRef.current) {
      applyTheme(lightRef.current, THEME_PRESETS.light.tokens);
    }
  }, []);

  return (
    <div className="dl-showcase">
      <header className="dl-showcase-head">
        <h1 className="dl-h1">Pi WSL Desktop — весь продукт</h1>
        <p className="muted">
          Design Lab: все экраны и элементы приложения на фикстурах — без Electron, Pi и WSL.
          Каждая рамка — настоящий компонент из <code>src/renderer/ui</code>.
        </p>
      </header>
      {sections.map((section) => (
        <section key={section.title} className="dl-showcase-section">
          <div className="dl-showcase-label">
            {section.title}
            {section.hint ? <span className="dl-showcase-hint"> — {section.hint}</span> : null}
          </div>
          <div
            className={`dl-showcase-frame${section.scroll ? ' dl-showcase-frame--scroll' : ''}`}
          >
            {section.light ? (
              <div ref={lightRef} className="dl-showcase-fill">
                {section.node}
              </div>
            ) : (
              section.node
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function showcaseSidebar(navActive: string | undefined) {
  return (
    <Sidebar
      header={F.SIDEBAR_HEADER}
      projects={F.SIDEBAR_PROJECTS}
      nav={F.SIDEBAR_NAV.map((item) => ({ ...item, active: item.id === navActive }))}
      connection={F.CONNECTION}
    />
  );
}

/** Экран «пустой диалог» — честный старт без открытой сессии. */
export function EmptyChatScreen() {
  return (
    <AppFrame layout="inline" theme="dark" side={showcaseSidebar(undefined)} breadcrumb={<span>Диалог</span>}>
      <ChatView
        turns={[]}
        composer={null}
        notice={
          <div>
            <h2 className="dl-h2">Выберите диалог слева</h2>
            <p className="muted">
              Проекты и чаты загружаются из Pi в WSL. Открытие диалога запускает самую свежую
              сессию; создание файлов сессий доступно в Pi CLI.
            </p>
            <button type="button" className="dl-btn-primary">
              Открыть последний диалог
            </button>
          </div>
        }
      />
    </AppFrame>
  );
}

/** Фикстурный реестр модулей M3 (включён/отключён/заблокирован/некорректен). */
const SHOWCASE_MODULES: ModuleEntry[] = [
  {
    key: 'demo/main',
    id: 'demo',
    state: 'enabled',
    errors: [],
    manifest: {
      id: 'demo',
      version: '1.0.0',
      apiVersion: 1,
      capabilities: ['sessions'],
      ui: [
        {
          kind: 'tab',
          id: 'main',
          title: 'Демо',
          blocks: [{ type: 'text', value: 'Вкладка модуля регистрируется манифестом.' }],
        },
      ],
      actions: [],
      dependencies: [],
      params: {},
    },
  },
  {
    key: 'time/main',
    id: 'time-tools',
    state: 'disabled',
    errors: [],
    manifest: {
      id: 'time-tools',
      version: '0.3.1',
      apiVersion: 1,
      capabilities: ['runtime'],
      ui: [
        {
          kind: 'panel',
          id: 'main',
          title: 'Время',
          blocks: [{ type: 'text', value: 'Панель модуля отключена владельцем.' }],
        },
      ],
      actions: [],
      dependencies: [],
      params: {},
    },
  },
  {
    key: 'net/main',
    id: 'net-fetch',
    state: 'blocked',
    errors: ['Зависимость net-core не зарегистрирована'],
    manifest: {
      id: 'net-fetch',
      version: '2.0.0',
      apiVersion: 1,
      capabilities: ['resources'],
      ui: [
        {
          kind: 'tab',
          id: 'main',
          title: 'Сеть',
          blocks: [{ type: 'text', value: 'Модуль заблокирован зависимостью.' }],
        },
      ],
      actions: [],
      dependencies: ['net-core'],
      params: {},
    },
  },
  {
    key: 'broken',
    id: 'broken-module',
    state: 'invalid',
    errors: ['manifest: неожиданный формат ui[0].kind'],
    manifest: null,
  },
];

/** Экран «Модули» — реестр M3 с рабочим переключателем (фикстуры в памяти). */
export function ModulesScreen() {
  const [entries, setEntries] = useState<ModuleEntry[]>(SHOWCASE_MODULES);
  return (
    <AppFrame
      layout="inline"
      theme="dark"
      side={showcaseSidebar('modules')}
      breadcrumb={<span>Модули</span>}
    >
      <div className="dl-showcase-fill" style={{ padding: 14, overflow: 'auto' }}>
        <ModulesView
          entries={entries}
          onToggle={(moduleId, enabled) =>
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === moduleId
                  ? { ...entry, state: enabled ? 'enabled' : 'disabled', errors: [] }
                  : entry,
              ),
            )
          }
        />
      </div>
    </AppFrame>
  );
}
