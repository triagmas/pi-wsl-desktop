# STATUS.md — текущий прогресс (измерения, не обещания)

Обновлено: 2026-10-25 (раунд 3: ячейки 10–36 из Component Library v5).
Связанные записи: `agent-output.log` (находки и циклы проверок),
`docs/ui/design-lab-component-board.md` (полный отчёт владельцу).

## Ветка / состояние

- Ветка `design-lab-d1`; предыдущий head: `a8be1e0` (board раунд 2, «поправь 6 и 9»).
- Страница board: `http://localhost:5199/?state=board` (интерфейс скроллится внутри
  `.dl-board` — 4802px, 36 ячеек).
- PR #23 (UI-A R02/R03) заморожен; merge НЕ выполнялся; Issues #16 и #21 открыты.

## Что сделано в раунде 3

- Разобран `Reference/Pi-WSL-Desktop-Component-Library-v5.zip`:
  `components.json` (37 единиц), `preview-cases.json` (84 кейса).
- Маппинг: 9 ячеек 01–09 уже покрывали 9 интерфейсных компонентов; Tokens → шапка;
  **добавлены 27 отсутствующих ячеек 10–36** в порядке registry v5
  (Типографика, Иконки, Select, Switch, Checkbox, Choice, Range, ActionMenu, Status,
  Progress, Attachment, ContextBreakdown, TreeView, CodeViewer, DiffViewer, SettingRow,
  ThemeEditor, EnvironmentCheck, ResourceItem, MetricGroup, TimeSeriesChart,
  ActivityGrid, DataTable, InlineAlert, Toast, Dialog(modal), EmptyState).
- Стилистика — как в ячейках 01–09: токены `--pw-*`, em-кегли, живые контролы,
  только fixture (без Electron/Pi/WSL/IPC/~/.pi).
- Новый файл `src/renderer/ui/BoardCellsV5.tsx` + v5-секция `board.css`;
  `BoardScreen.tsx` подключает `V5_CELLS`/`V5Body` (36 ячеек, счётчик в шапке).

## Гейты (фактические команды, PASS/FAIL/SKIP/NOT RUN)

- tsc node + tsc web: **PASS 0/0**
- `npx eslint .`: **PASS 0**
- vitest полный: **PASS 607 passed / 10 skipped** (60 файлов)
- `npm run build`: **PASS**
- E2E Playwright `--grep "UI-A"`: **PASS 3/3**
- Проба v5 (`artifacts/probe-v5.mjs`): **PASS 42/42, 0 ошибок** (найден баг `ui` vs
  `renderer` в TreeView — исправлен, RED→GREEN)
- Регресс 01–09 (`probe-board.mjs`): **PASS, 0 ошибок**
- Адаптив 1100/760 + состояния ref1–ref6/settings/demo: **PASS, 0 ошибок, без переполнения**
- Полный Electron E2E / installer / CI: **NOT RUN** (вне-скоуп design-правок)

## Следующий шаг

**Visual ACCEPT / замечания владельца** по раунду 3:
`localhost:5199/?state=board` (скролл до ячеек 10–36),
скриншоты `artifacts/design-lab/v5-scroll-0..5.png`,
ZIP **`F:\_tmp\d1-b-board-v5.zip`**
(sha256 `948dcb4a71026c3ca5eba1e51fa52c674d4fe6e016ef03806d8b8c95c22007c8`, 31 entry).
Merge PR #23 — только по прямому разрешению владельца.
