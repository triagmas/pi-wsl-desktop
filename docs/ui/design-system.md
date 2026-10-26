# UI-A Design System & Application Shell (Issue #21)

Статус: исторический технический отчёт UI-A R01 (PR #22, слит 23 октября 2026 года). Ниже сохранены решения и ограничения того этапа; это не описание текущей интеграции.

Актуальный визуальный источник — утверждённый [Design Lab](../../design-lab/README.md) и его общая композиция с Electron. Перенос ведётся в PR #24; технический ACCEPT UI-A R01 не подтверждает визуальную приёмку реального Windows-окна. Текущий шаг и оставшийся UI-B — в [ROADMAP.md](../../ROADMAP.md).

## Маппинг мокап → экран (Issue #21, открыты все 6 PNG)

| Mockup | Экран |
|---|---|
| 1 — тёмный, левая свёрнута (rail), панель «Детали действия» | shell + правая панель деталей |
| 2 — тёмный, левая развёрнута (проекты/чаты), правая скрыта | базовый chat (default) |
| 3 — тёмный, «Ресурсы / Skills» | ResourcesView (M2) |
| 4 — светлый chat | тема Light того же layout |
| 5 — тёмный, терминал строго под композером + глобальный статус-бар | приоритетный layout центра |
| 6 — светлый, «Ресурсы / Skills» | Light для ResourcesView |

## Источник истины токенов

- `src/shared/design/presets.ts` — 4 неизменяемых пресета (dark/light/claude/codex) с полным
  набором семантических токенов (цвета фона/текста/акцента/кнопок/инпутов/границ/статусов/
  инструментов/кода/терминала с ANSI-палитрой, радиусы, spacing, duration).
- `src/shared/design/contrast.ts` — WCAG-пары; каждый пресет обязан пройти AA-проверку
  (тест `tests/unit/designSystem.test.ts`).
- `src/renderer/design/applyTheme.ts` → CSS-переменные `--pw-*` + `color-scheme`;
  `applyTypography.ts` → `--pw-font-<area>-*`.
- `src/renderer/index.css` — только `var(--pw-*)`; литералы цветов запрещены.

## Темы (§9.2)

- 4 пресета + «Своя тема» с редактором: выбор основы, все семантические цвета (color-picker),
  радиусы/ритм, live preview (только document theme — Pi-данные не затрагиваются).
- **Fail-safe**: apply отклоняется при невалидном hex или нарушении контрастных пар с
  показом списка проблем и кнопкой «Исправить» (`src/renderer/design/customTheme.ts`,
  тест `tests/ui/themeEditor.test.tsx`).
- Save/Cancel/Reset: запись через `appearance:get/set/reset` в userData `appearance.json`
  (versioned, атомарно, per-field repair — `src/main/appearanceStore.ts`).

## Типографика (§9.3)

8 независимых областей: ui, sidebar, chatInput, chatResponse, code, toolOutput, terminal,
statusBar — семейство/размер/строка/насыщенность независимо от темы, живой preview
(`tests/ui/themeEditor.test.tsx`, applyTypography unit tests).

## App Shell (§5, §8)

- Дефолт — чат (пустое состояние с реальным StatusPanel); настройки — отдельный экран
  (Внешний вид / Типографика / Рабочее пространство / Подключение).
- Левая панель: проекты/чаты (M1), поиск, сворачивание в rail 48px; вкладки модулей M3 —
  под-навигацией при «Модули» (контракт testid `tab-module-*` сохранён).
- Правая панель «Детали действия»: реальные chat-инструменты; вкладки «Файлы/Изменения»
  отсутствуют (нет реализации — не имитируем).
- Статус-бар: подключение + дистрибутив слева; CPU/RAM Windows честно `—` (нет данных);
  кнопка терминала disabled (слот инертен, UI-B).
- Layout state — производное от persisted appearance (drag-контролы пишут сразу в store).

## Известные ограничения (disclosed)

- Windows CPU/RAM: всегда `—` до реального монитора (UI-B/R02).
- `makensis`/реальный рантайм в этой среде недоступны; локальный полный E2E выполняется
  WSL-раннером (`node node_modules/@playwright/test/cli.js test` + linux-electron, 13/13
  ×2 стабильно); `npx playwright test` здесь — Windows-нода и несовместим с bash-фикстурами.
  CI gate: Linux job `xvfb-run -a npx playwright test` — 3/3 PASS на HEAD (Linux E2E,
  Windows installer+packaged smoke, Documentation). Реальный Windows+WSL профиль-гейт
  (запуск с настоящим Pi в рабочем профиле) — NOT RUN (consent обязателен).
- jsdom не эмулирует `input[type=color]` для React onChange — editor tokens доказываются
  текстовым полем (radiusSmall); цветовые инпуты покрыты render/apply-ассертами.
- Issue #19 (документационная синхронизация) не затрагивался; UI-B не начат.
