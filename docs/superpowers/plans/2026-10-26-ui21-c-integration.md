# План: UI21 C — перенос принятого Design Lab в продукт

Владелец: вариант C — сначала устранить расхождения витрина ↔ реальный Electron,
затем PR + merge (merge только с отдельного прямого разрешения).

Входные данные: витрина `?state=showcase` принята; парные скриншоты
`F:\_tmp/dc-*` (витрина `dc-lab-sec01..10` ↔ Electron `dc-electron-*`,
чистый профиль, fake transport, 1586×992); два read-only инспекционных отчёта
(subagent-artifacts `724892ce…` и `ae455112…`).

## Зафиксированные расхождения

### Продукт (чинить в основном проекте)

- **P1. Ресурсы**: `App.tsx:690–691` рендерит legacy `ResourcesView` (таблица,
  слитые табы) вместо принятого `ui/ResourcesScreen`. Прямая замена
  **неэквивалентна**: у `ui/ResourcesScreen` нет lifecycle/тестов/interactions
  (вкладки-кнопки, search/source, установка, Packages/MCP, plan→confirm→apply→
  →rollback, loading/error/notice/diagnostics), `data-testid` отсутствуют.
- **P2. Настройки**: `App.tsx:692–739` рендерит legacy `SettingsView` вместо
  принятого `ui/SettingsScreen`. Прямая замена **неэквивалентна**: нет секционной
  навигации, radio-карточек, custom theme editor (validation/preview/cleanup),
  typography/layout controls, настоящего `StatusPanel`, testid-контракта.
- **P3. Шапка сайдбара**: продукт передаёт `header={collapseToggle}` только с
  иконкой (`LeftSidebar.tsx:237`), у принятой витрины — «📁 Открыть проект» +
  кнопка сворачивания (`design-lab/fixtures.tsx:173–184`).
- **P5. Кнопка «Открыть последний диалог»** переносится на 2 строки
  (`ui/Sidebar.tsx:113–118`, `components.css:1603–1610`): нет nowrap/ellipsis.
- **P7. `.panel-header h2`** не ограничен в `index.css` (h3 = 15px есть) —
  заголовок «Модули» крупнее витринного.

### Не-расхождения (зафиксировано инспекцией, не править)

- **Порядок «поиск → кнопка»** в `?state=app` совпадает (оба `searchFirst=true`);
  расхождение видно только в ref-семействе витрины и в новой секции showcase.
- **Nav-состав продукта** функционально верен: `Чат`, динамические вкладки
  модулей (`Демо-модуль`), `Ресурсы`, `Модули`, `Настройки`. «Использование» —
  только иллюстративный пункт эталона/фикстур; экрана/маршрута в продукте нет
  (новый функционал — вне скоупа, не начинать).
- Фикстурные данные (E2E fixture session, CPU/RAM «—», «Reальный PTY в UI-B»)
  — честные, не редактировать.

### Витрина (правки design-lab, гейты design-lab)

- **L1. Табы сессии История|Чат** отсутствуют в `AppScreenLab`
  (`design-lab/AppScreen.tsx:62`); в продукте `App.tsx:511–535`. Решение:
  общий `ui/SessionTabs`, используемый продуктом и лабой (одна композиция).
- **L2. Секция «Пустой диалог»** (`design-lab/Showcase.tsx`) неполна относительно
  продукта: нет статус-цепи, терминального дока и статус-бара.
- **L3. showcase секция пустого чата** — привести сайдбар секции к порядку
  `AppScreen` (searchFirst), чтобы секция не расходилась с секцией 1.

## Пакеты работ (TDD, связные изменения)

### P-1 — быстрые выравнивания (design-lab + продукт)

1. **P5**: `ui/Sidebar.tsx` — label в `span.dl-newchat-text`; CSS: nowrap,
   overflow hidden, ellipsis, min-width 0 (кнопка и текст). RED: DOM-тест
   наличия span + сохранение контракта appShell (нет «Новый диалог»).
2. **P7**: `index.css` — `.panel-header h2` = 15px (паритет h3). RED: тест
   чтения правила (unit).
3. **P3**: `LeftSidebar.tsx:237` — header-композиция «📁 Открыть проект» +
   `collapseToggle`. Действия открытия проекта в мосту нет → текст-заголовок
   (не button), честно; отдельный Issue на действие — по решению владельца.
   RED: appShell-тест наличия «Открыть проект».
4. **L1**: выделить `ui/SessionTabs` (props: mode, onChange, testid
   tab-history/tab-chat); подключить в `App.tsx:511–535` и в `AppScreenLab`.
   RED: тесты на обеих сторонах.
5. **L2/L3**: `Showcase.tsx` — EmptyChatScreen на `AppScreen` (statusBar + док +
   статус-цепь фикстур), `searchFirst`.

Гейты P-1: tsc node+web, eslint, build, полный vitest, e2e, design-lab-пробы.

### P-2 — Ресурсы (P1)

1. Расширить `ui/ResourcesScreen` совместимо: controlled вкладки
   (`onTabChange`), настоящий `input` поиска и source-фильтр (локальная фильтрация
   inventory, пустая выборка ≠ пустой inventory), слоты панелей
   Skills/Packages/MCP, слоты install/MCP-форм, plan/result/error/diagnostic,
   testid на реальных строках/действиях (`skill-toggle` внутри `skill-row`),
   сохранить `aria-pressed`/`aria-selected`.
2. `ResourcesView` остаётся M2-контроллером (m2api preview→confirm→apply→
   →rollback), но рендерит презентацию через `ui/ResourcesScreen`.
3. Ничего не помещать из api/IPC в презентационный слой; design-lab-вызовы
   (`main.tsx`) остаются валидными (новые пропы опциональны).

RED: интеграционный тест App-маршрута resources (утверждённые `.dl-*` узлы +
все legacy testid/interactions), затем существующие `m2Resources.test`,
`e2e/m2.spec` должны остаться зелёными.

### P-3 — Настройки (P2)

1. Расширить `ui/SettingsScreen`: секционная навигация (tabs appearance/
   typography/workspace/connection), карточки тем как `button role=radio` с прежними
   testid, слоты: custom theme editor (целиком существующий с cleanup/preview),
   typography controls, layout controls, `StatusPanel`.
2. `SettingsView` остаётся контроллером appearance/layout/connection, рендерит
   через `ui/SettingsScreen`.
3. design-lab-вызовы сохранить (старые пропы работают по умолчанию).

RED: интеграционный тест App-маршрута settings; существующие `themeEditor.test`,
`e2e/ui.spec` (98–195, 202–266) — зелёные.

### Финал

- Полные гейты: tsc, eslint, build, vitest, e2e, design-lab-пробы; WSL-smoke
  скриншоты сравнений с витриной (dc-пары обновить).
- Независимый `pi-desktop-review` (read-only, gpt-6.1-sol) → фикс находок.
- Итоговый отчёт владельцу: diff, гейты PASS/NOT RUN, STOP перед merge PR.

## Риски

- P1/P2 — самый высокий риск потери confirmation/rollback, redaction,
  custom editor cleanup; покрытие legacy-тестами напрямую на view не спасает
  App-маршрут → обязательны интеграционные RED-тесты.
- Не удалять массово legacy CSS (совместные селекторы `.res-panel,.module-panel`).
- Не менять nav-состав продукта и не добавлять «Использование» (вне скоупа).
