# STATUS.md — текущий прогресс (измерения, не обещания)

Обновлено: 2026-10-25 (после правки пунктов 06 и 09 страницы board).
Связанные записи: `agent-output.log` (находки и циклы проверок),
`docs/ui/design-lab-component-board.md` (полный отчёт владельцу).

## Ветка / состояние

- Ветка: `design-lab-d1`; предыдущий head: `41c14ac` (board раунд 1).
- Страница board: `http://localhost:5199/?state=board` (Design Lab, `npm run design`).
- PR #23 (UI-A R02/R03) заморожен; merge НЕ выполнялся; Issue #21 открыт.

## Что сделано в этом цикле (round 2: «поправь 6 и 9»)

| Пункт | Было (замер) | Стало (замер) |
|---|---|---|
| 06 Поле ввода | без бокса-рамки, input в браузерном дефолте, стоп — accent | бокс как в эталоне (фон/рамка по токенам), живой input (17px), чип 15px, send 54×54 по центру, стоп `#5c3d3c` + квадрат `#f56661` (измеренные), toggle `.is-stopped` |
| 09 Статус-бар | кегль 9px, обрезка «Терминал», «Windows», невидимая hit-зона | full-bleed полоса снизу (h48, как эталон), кегль 10.08px, состав без «Windows» (эталон), sw=492=w — обрезки нет, настоящая кнопка `onTerminalToggle` (aria-pressed false→true) |

## Гейты (фактические команды, PASS/FAIL/SKIP/NOT RUN)

- tsc node + tsc web: **PASS 0/0**
- `npx eslint .`: **PASS 0**
- vitest полный: **PASS 607 passed / 10 skipped** (60 файлов)
- `npm run build`: **PASS**
- E2E Playwright `--grep "UI-A"`: **PASS 3/3**
- Playwright интерактив-проб board: **PASS**, 0 ошибок страницы, все проверки (см. agent-output.log)
- Playwright regl ref1–ref6/settings/demo: **PASS**, 0 ошибок
- Полный Electron E2E / installer / CI: **NOT RUN** (вне-скоуп design-правок)

## Grounding (главные измерения эталона round 2)

- 06: send 52×54 центр-по-вертикали; стоп бокс (92,61,60)/квадрат (245,102,97) 40×42.
- 09: полоса 515×48, кегль ≈10.5px, состав без «Windows»; кнопка ≈ accent α53%.
- Источник 06: `Reference/Pi-WSL-Desktop-Component-Library-v5.zip` → `Composer` (anatomy/варианты подтверждены). Источника по StatusBar в v5 нет → ground truth = `component-board.png`.

## Следующий шаг

**Visual ACCEPT / замечания владельца** по round 2:
`localhost:5199/?state=board`, composite `F:\_tmp\d1b-cmp-06-09.png`
(sha256 `59a91b77fc5cdd32ba09d90a151a3bd4b5764ccdadec5470d05d6c3c43866fc2`),
ZIP `F:\_tmp\d1-b-board-round2.zip` (sha256 `cfe30349f0c19d852c38304c0bac231036ab4312d91973c1e020d038fe8df4a4`).
Merge PR #23 — только по прямому разрешению владельца.
