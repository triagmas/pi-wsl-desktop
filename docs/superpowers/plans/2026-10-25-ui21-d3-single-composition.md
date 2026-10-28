# D3 — единая композиция Design Lab ↔ Electron (Issue #21, owner #6398531407)

ЗАПРЕТЫ: новый дизайн/новая композиция, пиксельное копирование Reference,
merge/installer/release, review-марафоны. STOP перед визуальной приёмкой.

Ground truth: `design-lab/AppScreen.tsx`, `?state=board`, `src/renderer/ui/*`,
CSS-токены/типографика/компоненты Design Lab.

## WP0 — контекст
- Ветка `feat/ui21-integration-r01` (HEAD `31f46e2`), PR #24 draft, base main.
- Диагноз владельца: Electron (shell/* + StatusPanel + centerHeader/centerBody +
  app-оверрайды типографики) ≠ Design Lab иерархией и кеглями; D2 принял
  переиспользование компонентов за переиспользование композиции.

## WP1 — RED-контракты (tests/ui/appShell.test.tsx + typography-тесты)
1. Главный экран: цепь `.dl-frame[data-layout=app] > .dl-side > aside.dl-sidebar`
   (без legacy-обёрток), `ui/StatusBar` рендерится напрямую (нет
   StatusPanel/h2-диагностики в пустом чате), пустое состояние — внутри
   утверждённой чат-композиции (ChatView-цепь), crumb-row один.
2. `DEFAULT_TYPOGRAPHY` = canonical из typography.css
   (ui 18/1.40/500, sidebar 17/1.50/400, chatInput 20/1.45/400,
   chatResponse 20/1.55/400, code 17/1.50/500, toolOutput 16/1.50/400,
   terminal 17/1.50/400, statusBar 16/1.40/400; стеки = --dl-font-stack / --dl-font-mono).

## WP2 — `src/renderer/ui/AppScreen.tsx` (ОДНА композиция главного экрана)
Фиксированная иерархия как в design-lab/AppScreen:
`AppFrame(layout=app)` со `side`, `details {header,body,?handle}`,
`children = [headerRow(dl-app-crumb: crumb + actions), guard?, panels?, body]`,
статус-бар рендерится компонентом `ui/StatusBar` по пропам-данным
(ветка/connection/distro/right/terminal + testids). Data+callbacks через props,
без fixture-импортов.

## WP3 — Design Lab → тонкий адаптер fixtures (design-lab/AppScreen.tsx)
Импортует `ui/AppScreen`, прокидывает fixtures. Гейт: design-lab probes 43/43 +
скриншоты лабы не изменились (визуал ground truth неприкосновенен).

## WP4 — Electron → тот же ui/AppScreen
- Убрать из главного экрана: legacy `StatusPanel` (остаётся только внутри
  SettingsView), `.empty-state` h2-диагностику, двойные обёртки
  (`left-sidebar`/`dl-side-wrap` → напрямую `ui/Sidebar`/`ui/Rail` + те же testid),
  `shell/StatusBar` (маппинг phase→connection переносится в App, рендер —
  `ui/StatusBar`), свой `centerHeader`.
- Пустое состояние: чат-состояние внутри AppScreen-body (та же цепь
  composition) + компактная реальная connection-info (reuse connection-стиль),
  кнопка «Открыть последний диалог» сохраняется.
- Активная сессия: crumb+tabs+HistoryView|ChatPane переезжают в headerRow
  (crumb слева / actions справа — как в лабе), ChatWorkspace теряет свой crumb.
  Terminal-dock узел → в хвост chat-цепи (как `ChatView.terminal` в лабе),
  testid/aria-контракты сохраняются, честные надписи без фиктивного PTY.
- Панели: `useResizeHandle`/коммиты appearance остаются как есть (data/callbacks).

## WP5 — типографика
`DEFAULT_TYPOGRAPHY`/стеки → canonical (WP1); app-оверрайды
`--dl-fs-*: var(--pw-font-*, …)` остаются (user override работает, дефолт = лаба).

## WP6 — CSS-баги против лабы
- Скоупить глобальные элементные сбросы layout.css под `.dl-frame`.
- TitleBar app: grid-template-columns отсутствует — замер лабы → правило,
  воспроизводящее лабу (не новый дизайн).
- Убрать legacy-копии `.center-workspace`/app-правила из index.css, если они
  дублируют design-слой.

## WP7 — доказательство визуальной эквивалентности
Лаба `?state=app` (dark, details on, terminal on) ↔ реальный Electron (linux,
реальные Pi/WSL-данные, временный профиль) при 1239×898 (viewport владельца):
парные скриншоты (пусто + открытая сессия) + таблица DOM bbox/computed для
titlebar/side/center/details/composer/status/dock. ZIP в `F:\_tmp`.
Ограничение среды: голый `electron.exe` из текущего WSL не стартует — фиксируем
явно, renderer-код идентичен.

## WP8 — гейты, отчёт, STOP
vitest полный, e2e полный, probes 43/43, build/lint/tsc; push → PR #24
обновляется (без merge); отчёт в Issue #21 со скриншотами; STOP перед
визуальной/функциональной приёмкой.
