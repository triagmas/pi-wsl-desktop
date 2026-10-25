---
name: pi-desktop-design-lab
description: Visual iterations in the isolated Design Lab (design-lab/, ?state=ref1..ref6|board|settings|demo): match Reference/ etalons, board component sheet, design tokens, coordinate measurement, screenshot composites, interactive Playwright probes, owner Visual ACCEPT gate. Use for visual-style tasks — «сделай как на референсе/эталоне», правка ячейки board, цвета/шрифты/геометрия/раскладка, сравнение скриншотов, visual fidelity — when no functional contract changes.
---

# Pi Desktop — Design Lab (визуальные итерации)

Scope: только визуальный слой (design-lab/, `src/renderer/design/*.css`,
проп-компоненты `src/renderer/ui/*`). Функциональные контракты, merge, UI-B и
реальные установки — вне этого Skill (см. «Конфликт»).

## Когда использовать

Автозагрузка, если задача содержит любое из: `design-lab`, `localhost:5199`,
`?state=ref…|board`, `Reference/` + эталон/референс, `component-board`,
правка board-ячейки/10–36, composite-сравнение скриншотов, «визуальная
приёмка/Visual ACCEPT», visual fidelity, типографика/пресеты на странице lab.

НЕ грузить вместо продуктовых Skill: изменение функциональных контрактов
(bridge/protocol/hooks/IPC), подготовка merge, M4/UI-B, установка/uninstall —
там `pi-desktop-development` + `pi-desktop-safety` + полные гейты.

## Процедура (повторяемая методика D1-b)

1. **Инвентаризация референсов**: `ls Reference/` (PNG + MD). Прочитать нужные
   MD целиком: `Reference/BOARD-PROMPT.md`, `PROMPTS.md`, `IMPLEMENTATION-PROMPT.md`,
   `DESIGN-UPDATE.md`. Сверить md5 референсов Issue с `Reference/`. Определить
   design variant; разные варианты (v3-значения vs Issue-эталоны vs текущий слой)
   **не смешивать** — конфликт → owner-gate.
2. **Визуальная композиция**: состояние/ячейка = fixture; чистые проп-компоненты
   + отдельный CSS; подключение состояния в `design-lab/main.tsx`; без
   Electron/Pi/WSL/IPC/user `~/.pi`.
3. **Дизайн-токены**: только `--pw-*` из `src/shared/design/presets.ts`
   (иммутабельны, Issue §1); производное — `color-mix` на токенах. Измеренные
   «эталонные» цвета/габариты (напр. стоп `#5c3d3c`/`#f56661`, полоса 515×48)
   документируются в отчёте, а не вносятся в палитру пресетов.
4. **Переиспользуемые компоненты**: расширять существующие `src/renderer/ui/*.tsx`
   только **опциональными** пропсами (примеры: `TerminalPane.onSelectTab`,
   `StatusBar.onTerminalToggle`) — без них прежний контракт и поведение.
5. **Стабильные шрифты**: `design-lab/fonts.conf`; каждый Playwright-запуск —
   `chromium.launch({ env: { …, FONTCONFIG_FILE: 'design-lab/fonts.conf' } })`;
   иначе fallback-шрифт и все замеры ложные.
6. **Измерение координат**: эталон — pixel-скан (PIL) или DOM
   `getBoundingClientRect`/`getComputedStyle` из проб `artifacts/probe-*.mjs`
   (gitignored); пробы держать в каталоге репо (импорт `@playwright/test` из
   `/tmp` падает). Сравнивать с ОРИГИНАЛОМ `Reference/*.png`.
7. **Сравнение скриншотов**: composite «REFERENCE ⇄ OURS» (PIL) класть в
   `F:\_tmp` (не `/tmp`), sha256 — в отчёт. Помнить: `element.screenshot`
   клипается по bounding box — выпадашки/оверлеи снимать viewport-скриншотом.
8. **Интерактивные проверки**: одна проба на все проверки (aria-pressed/
   expanded/checked, счётчики, `pageerror === 0`); после каждой правки
   перезапускать свой dev-сервер WSL-vite (см. Pitfalls).
9. **Owner Visual ACCEPT** — стоп-гейт: живая страница + скриншоты/ZIP в
   `F:\_tmp` + отчёт (`docs/ui/design-lab-component-board.md`,
   `docs/ui/design-lab-comparison.md`). Не форсировать приёмку, не делать merge.

## Гейты и конфликт с `pi-desktop-development`

- **Чисто визуальная итерация** (только design-слой/фикстуры): `npx tsc -p
  tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`,
  `npx eslint .`, `npm run build` + адресные Playwright-пробы; целевой
  Vitest-файл только если тронут общий модуль (напр.
  `tests/unit/designSystem.test.ts` под `contrast.ts`). **НЕ запускать**: полный
  Vitest, Electron E2E, installer, CI.
- **Изменён функциональный контракт или готовим merge**: обычные продуктовые
  гейты по `pi-desktop-development` (typecheck/lint/build/`npm test`/
  `test:e2e`/CI, `NOT RUN` — явно) + независимый `pi-desktop-review`.
- Оба Skill применимы совместно; приоритет у этого — только для визуального цикла.

## Pitfalls

- WSL-vite отдаёт stale файлы → перезапуск своего процесса и проверка свежести
  маркером в выдаче; не считать это зависанием.
- **Петли замеров запрещены владельцем** (дважды): максимум один цикл
  «замер → фикс → число»; финализация — документация/скриншот/коммит.
- Запрещены: правки вне design-слоя, `wsl --unregister/shutdown`, реальные
  записи в `~/.pi`, merge, UI-B (реальные CPU/RAM), платные prompt.
- setState синхронно в effect — lint-запрет; управление — state + один эффект.

## Verification

- Пробы PASS и `errors: 0`; гейты — конкретные PASS/FAIL/`NOT RUN`; отчёт
  обновлён; ZIP sha256 указан; `git status` без постороннего после коммита
  (коммит — по отдельному согласию).
- Валидация Skill (lifecycle): позитив «правка ячейки board по эталону» →
  загрузить; негатив «почини bridge-контракт» → не этот; регресс «правка CSS
  с изменением функционального пропса» → переключиться на
  `pi-desktop-development` + полные гейты.

## Ссылки (не копировать сюда)

`docs/ui/design-lab-component-board.md` (структура 36 ячеек, гейты, замеры) ·
`docs/ui/design-lab-comparison.md` (дельты токен↔эталон) · `design-lab/README.md`,
`capture.mjs`, `fonts.conf`, `main.tsx` · `Reference/*.md`, `component-board.png`,
библиотека `Reference/Pi-WSL-Desktop-Component-Library-v5.zip` (реестр — там же) ·
`src/renderer/design/{board,components,layout,typography}.css`,
`src/renderer/ui/{BoardScreen,BoardCellsV5}.tsx`.
