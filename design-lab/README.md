# Design Lab — утверждённый визуальный источник

Component Library v5, Board, композиция `?state=app` и принятая витрина `?state=showcase` задают внешний вид, который переносится в Windows Electron. [Решение владельца](https://github.com/triagmas/pi-wsl-desktop/issues/21#issuecomment-6398531407) · [Текущий шаг и приёмка](../ROADMAP.md#ближайшая-работа--визуальная-приёмка-переноса-design-lab).

**DEMO-предпросмотр.** Изолированная Vite-страница с React/CSS-слоем
Pi WSL Desktop: **без Electron, Pi, WSL Bridge, model calls, IPC и
пользовательского `~/.pi`**. Все данные состояний — иллюстративные фикстуры
(`fixtures.tsx`), включая строки терминала и DEMO-метрики статус-бара
(реальных CPU/RAM здесь нет — это предстоящий UI-B).

## Запуск

```bash
npm run design          # dev-server на http://localhost:5199
```

Состояния: `?state=ref1 … ref6` (шесть исходных эталонов Issue #21), `?state=settings`,
`?state=demo`, `?state=board`, `?state=showcase` (витрина из 10 секций), `?state=app` (главный экран D1-этап 2; геометрия-
альтернативы — `&variant=a|b`). Плавающий picker внизу справа — тоже DEMO-подписи;
`?bare=1` скрывает его (для скриншотов).

| state | мокап | что показывает |
|---|---|---|
| ref1 | тёмный, rail + «Детали действия» | split-layout, toolbar, активный шаг, тултип |
| ref2 | тёмный, sidebar, чат | inline-layout, populated chat, hint |
| ref3 | тёмный, «Ресурсы / Skills» | ResourcesScreen, активный nav |
| ref4 | светлый, sidebar, чат | светлая тема того же layout |
| ref5 | тёмный, терминал + статус-бар | терминал строго под композером, statusbar |
| ref6 | светлый, «Ресурсы / Skills» | светлая тема Resources |
| settings / demo | нет эталона | Настройки (§9.3: 5 тем, 8 зон) и Markdown-тело |
| showcase | принятая витрина | 10 секций для сравнения экранов и состояний с реальным приложением; демонстрационные данные |
| board | утверждённая библиотека | 36 ячеек Board, живые контролы темы/шрифтов, вкладки, поиск и статус-бар; [описание](../docs/ui/design-lab-component-board.md) |
| app | `Reference/01-chat-review-terminal.png` | целостный главный экран: «Открыть проект» + проекты, чат со свёрнутой сводкой, панель «Изменения» + diff, терминал, статус-бар с веткой; `&variant=a\|b` — альтернативы 44/28/260/340 и 36/26/240/360; см. `docs/ui/design-lab-app-composition.md` |

## Границы изолированного просмотра

- **Можно**: править design-слой (`src/renderer/design/*.css`,
  `src/renderer/ui/*.tsx`) и фикстуры, перезапускать, сравнивать со скриншотами.
- **Внутри Lab нельзя**: подключать Pi/WSL/IPC/реальные данные, трогать работающие
  модули (`src/renderer/shell/*`, `useChat`, bridge), запускать полный Vitest /
  Electron E2E / installer / CI ради визуальных правок.

## Скриншоты

```bash
node design-lab/capture.mjs           # 6+2 состояния × 4 вьюпорта
node design-lab/capture.mjs ref2 ref5 # выборочно
# → artifacts/design-lab/<state>-<viewport>.png (gitignored)
```

Имена файлов честно указывают разрешение: `1586×992` — native-размер
эталонов Issue #21 (1:1), `1440×900/1280×800/1024×768` — baseline/responsive.
Скриншоты — **Design Lab DEMO**, не реальное приложение: в отчётных
side-by-side они подписываются как «Design Lab capture (DEMO)».

`capture.mjs` — dev-only инструмент: **не подключается к CI и тестам**.

## Шрифты

Эталоны набраны Segoe UI; в WSL его нет по умолчанию. Capture поднимает
Chromium с `FONTCONFIG_FILE=design-lab/fonts.conf`, который подключает
`/mnt/c/Windows/Fonts` (нужен доступ к Windows-дискам; без него рендер
упадёт до системного шрифта — это ограничение честно указывается в отчёте).
Владелец на Windows открывает `localhost:5199` в обычном браузере — там
Segoe UI есть всегда.

## Связь с приложением

Общие компоненты `src/renderer/ui/*.tsx` и композиция `ui/AppScreen` используются адаптерами Lab и Electron в ветке интеграции PR #24. Lab передаёт фикстуры, приложение — реальные данные и обработчики. Демонстрационные данные из Lab не должны попадать в продукт. Перенос C1–C4 реализован; C5 и отдельная визуальная приёмка Windows-окна ещё впереди — см. [ROADMAP](../ROADMAP.md).

Параметры `variant=a|b` и страницы `ref1..ref6` сохранены для истории и сравнения. Они не открывают заново выбор дизайна: текущая задача — перенос уже утверждённого Lab. Старые расхождения с исходными PNG не являются новым заданием на перерисовку.

Исторические сравнения: [первый цикл](../docs/ui/design-lab-comparison.md), [Board](../docs/ui/design-lab-component-board.md), [композиция D1](../docs/ui/design-lab-app-composition.md). Технические проверки Lab и его демонстрационные скриншоты не заменяют Visual ACCEPT реального Windows-приложения владельцем.
