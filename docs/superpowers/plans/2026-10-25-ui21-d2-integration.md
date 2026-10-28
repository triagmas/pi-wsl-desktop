# 2026-10-25 — UI21 D2: интеграция Design-Lab компонентов в рабочее приложение (Issue #21)

Решение владельца: комментарий Issue #21 `#6395777040` — приоритет «работающее
Windows-приложение с настоящими Pi-сессиями», а не пиксельное копирование
Reference. Ветка: `feat/ui21-integration-r01` от `design-lab-d1@50724cb`.
PR #23 заморожен и не трогается. Merge/install/release — запрещены.

## Gap-анализ (шаг 1 по решению владельца)

Уже работает в `src/renderer/App.tsx` (main@53dc9c0): живые `useChat` (открытие,
send/stream/interrupt/close, ошибки/реконнект), `m1` (проекты/сессии/события),
`LeftSidebar` (данные + поиск), `RightSidebar` (реальные tools), `SettingsView`
(темы/типографика/ширины layout), `StatusBar` (реальное подключение, честные «—»),
`TerminalSlot` (инертная слот-резервация), persisted `appearance.layout`
(leftWidth/rightWidth/leftCollapsed/rightVisible/terminalSlotHeight).

Чего нет (предмет интеграции):
1. Одобренные `ui/*`-компоненты и `--dl-*` живут только в design-lab; в
   прод-рендер не импортируются ни компоненты, ни CSS (`layout.css`/`components.css`).
2. Нет перетаскивания ширины панелей (только слайдеры Settings) и сворачивания
   правой панели из шелла; нет терминального дока (скрытие/высота не persist-тся —
   поля `terminalVisible` в appearance отсутствует).
3. «Новый диалог» реально открывает самую свежую сессию (метода create нет в
   Bridge: ALL_METHODS = listProjects/listSessions/openSession/sendPrompt/
   interrupt/closeSession/…) — кнопка врёт пользователю → честная подпись.
4. Терминал: в Bridge/ main / preload **нет PTY-контракта** (grep pty|terminal —
   0 совпадений). Reuse только presentation; фиктивные строки запрещены.
5. TitleBar оконные кнопки декоративные, window frame включён — двойной тайтлбар
   при интеграции; нужны IPC-контролы + frameless + drag-region.
6. `SessionDetail` (История/Чат) и `ChatPane` — легаси-подача, не одобренный `ChatView`.

## Рабочие пакеты (TDD: RED → GREEN → Refactor; адресные тесты, полный набор — один раз на финальном HEAD)

- **WP1 Контракты** (unit): appearance `layout.terminalVisible` (default true,
  migrate/repair); window-controls IPC (`window:minimize|maximize|close`,
  `IpcOptions.windowControls`, preload + `DesktopApi.windowControls?` —
  optional, чтобы mock-объекты тестов не трогать).
- **WP2 Главное окно**: `frame: false`, `minWidth`; CSS `-webkit-app-region`
  для titlebar (no-drag кнопок); подключение controls в App → TitleBar.
- **WP3 Каркас**: импорт dl-CSS в прод-рендер (ПОСЛЕ index.css — класс-правила
  обоих семейств не конфликтуют, `dl-`-префикс уникален; элемент-сбросы layout.css
  (0,0,1) перекрывают legacy-классы только там, где legacy не задаёт класс);
  `App.tsx` → `ui/AppFrame` (layout=app) вместо `AppShell`; inline-стиль
  `--dl-app-side-w/--dl-app-details-w` из appearance (единый источник правды);
  `data-testid="app-shell"` сохраняется.
- **WP4 Левая панель**: `shell/LeftSidebar` остаётся контейнером данных (m1,
  поиск, expand), рендерит `ui/Sidebar` (+ `ui/Rail` в collapsed-состоянии);
  пропсы `searchValue/onSearchChange/newChatLabel` (optional — design-lab не
  меняется); честная подпись «Открыть последний диалог»; handle изменения
  ширины (pointer + keyboard, min 200 max 480) с persist.
- **WP5 Правая панель**: `shell/RightSidebar` рендерит `ui/DetailsPanel`
  (+ `DetailsHeader.onCollapse`, секция файлов рендерится только при
  непустых `files` — честное отсутствие); tools → rows «Инструментов»;
  handle ширины (240..560) с persist; фокус-возврат `open-details` сохраняется.
- **WP6 Статус-бар**: `shell/StatusBar` рендерит `ui/StatusBar` с реальным
  подключением/дистрибутивом, честными «—», кнопкой терминала = тумблер дока
  (aria-pressed), без выдуманной ветки.
- **WP7 Чат**: `ChatPane` становится адаптером поверх `ui/ChatView`
  (композер получает controlled-пропсы value/onChange/onSubmit/busy/onInterrupt;
  notice-слот для banner/error; tools → steps стрим-ответа; явный gate «Открыть
  чат», спиннер, финализация message_end — поведенческие тесты m1Chat сохраняются,
  селекторы обновляются под новую разметку). `SessionDetail` (История/Чат) —
  остаётся как есть (минимальная регрессия; визуал — позже по beta-итерации).
- **WP8 Терминальный док**: `shell/TerminalSlot` → док под центром:
  заголовок-тумблер (честно: «PTY подключается в UI-B»), пустой слот
  `data-testid="terminal-slot"` (без фиктивных строк), resize по высоте
  120..600 (pointer+keyboard), visible+height persist (`terminalVisible`).
- **WP9 Проверки**: typecheck/lint/build; адресные vitest по изменённым
  модулям; **один полный** `npm test` + `npm run test:e2e` на финальном HEAD;
  probe-скрипты: геометрия окна (resize, панели, док), DPI 100/125/150/200
  (deviceScaleFactor), keyboard (Tab/focus/стрелки на handle);
  **Windows smoke**: запуск настоящего `electron.exe` dev-режима с
  `PI_WS_DESKTOP_USER_DATA_DIR=F:\_tmp\...` (без записи в профиль), read-only
  загрузка реальных сессий WSL, скриншот; отправка prompt — ТОЛЬКО с
  разрешения владельца (NOT RUN в этом раунде).
- **WP10 Ревью + отчёт**: независимый `pi-desktop-review` (gpt-6.1-sol,
  read-only) после существенной интеграции; отчёт в Issue #21; PR
  base=`design-lab-d1`; STOP перед функциональной приёмкой.

## Границы / rollback

- Не трогать: PR #23/#19/#18, VoiceForge/ChatWake/Hermes, `~/.pi` (запись),
  платные prompts, merge, installer, 1.0.0, UI-B/PTY.
- design-lab (`design-lab/*`) остаётся fixture-only, в прод не монтируется.
- Rollback: `git checkout main && git branch -D feat/ui21-integration-r01`.
- Известный конфликт на будущее: frameless/window-controls пересекается с
  содержимым замороженного PR #23 — свод при слиянии решает владелец.
