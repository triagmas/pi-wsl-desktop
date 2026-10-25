# Design Lab (Issue #21, D1) — изолированный визуальный слой

**DEMO-предпросмотр.** Изолированная Vite-страница с React/CSS-слоем
Pi WSL Desktop: **без Electron, Pi, WSL Bridge, model calls, IPC и
пользовательского `~/.pi`**. Все данные состояний — иллюстративные фикстуры
(`fixtures.tsx`), включая строки терминала и DEMO-метрики статус-бара
(реальных CPU/RAM здесь нет — это UI-B, не начинался).

## Запуск

```bash
npm run design          # dev-server на http://localhost:5199
```

Состояния: `?state=ref1 … ref6` (шесть эталонов Issue #21), `?state=settings`,
`?state=demo`. Плавающий picker внизу справа — тоже DEMO-подписи;
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

## Что можно и чего нельзя

- **Можно**: править design-слой (`src/renderer/design/*.css`,
  `src/renderer/ui/*.tsx`) и фикстуры, перезапускать, сравнивать со скриншотами.
- **Нельзя (D1)**: подключать Pi/WSL/IPC/реальные данные, трогать работающие
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

Компоненты в `src/renderer/ui/*.tsx` — **presentational, pure props**, и
предназначены для будущей интеграции (D2/D3): приложение сможет рендерить их
теми же данными. В D1 они НЕ подключены к `src/renderer/App` — рабочие
Pi RPC/Bridge/функциональные модули не изменялись.

Известные расхождения с эталонами и решение владельца по ним —
`docs/ui/design-lab-comparison.md` (после первого цикла скриншотов).
