# UI-A R03 — owner-to-implementation mapping (Issue #21, PR #23)

> Один ограниченный пакет визуальных исправлений по visual-gate владельца
> (CHANGES REQUIRED, 6 пунктов) на существующей ветке `feat/ui21-visual-fidelity-r02`.
> База пакета: `c29088b` (R02 HEAD при review владельца). Все утверждения ниже —
> структурные (файлы/тесты/скриншоты); **pixel-level соответствие шести утверждённым
> PNG из Issue #21 проверяется владельцем на повторном Visual ACCEPT**.

## Кто что требовал → что сделано → где доказательство

| # | Требование владельца | Реализация | Доказательства |
|:-:|:--|:--|:--|
| 1 | **Chat first**: убрать промежуточные табы `История/Чат`, приглашение «Откройте чат», Pi RPC-абзацы из основного воркспейса; выбранная сессия → сразу разговор с нижним композером; диагностика → Settings→Connection | `SessionDetail` без табов: единый `.chat-entries` (история → чат → композер). `ChatPane`: отправка = явное действие (send-driven `open→send`, черновик переживает неудачный open). Убраны `chat-actions`/«Откройте чат заново». Заметка о границе записи — в Settings→Connection (`rpc-write-boundary-note`). Остаются только конкретные actionable-ошибки (`new-chat-error`, `chat-error`) | `tests/ui/m1Chat.test.tsx` (9 RED→GREEN: send-order, IME, conversation без табов, recovery-via-send), `tests/ui/visualFidelity.test.tsx` (RPC-note только в Settings), `tests/ui/appShell.test.tsx` (#126), E2E `e2e/m1.spec.ts`, `e2e/ui.spec.ts` (композер прижат, `ui-01/05`) |
| 2 | **New-dialog semantics**: честное создание через Pi RPC, если поддерживается; никакой переименовки «открыть последний»; без фейковых сессий и платных prompt | Bridge-метод `newSession` (`m1Protocol` + `M1_METHODS`): bare `pi --mode rpc` → `get_state` → `set_session_name('Новый диалог')` (source-verified durability: `appendSessionInfo` → `_persist` при первом flush) → fail-closed teardown. UI: primary «Новый диалог» (real creation), secondary — явно подписанный «Открыть последний диалог». Provisional-лifecycle: файл не существует до первого prompt; materialization подменяет provisional-запись настоящей записью из индекса; непроявленный диалог при закрытии честно исчезает. Однослотовость: `RESOURCE_BUSY` + guard-switch диалог | `tests/contract/m1Protocol.test.ts` (17→19), `tests/integration/bridgeM1.test.ts` (7→9: создание, VALIDATION/RESOURCE_BUSY, нет файла до prompt, durable-имя, baseline второго prompt), `tests/ui/visualFidelity.test.tsx` (create-label, busy-guard, empty-state CTA), E2E lifecycle в `e2e/m1.spec.ts` (create→send→materialize→строка в sidebar→round-trip) |
| 3 | **Hierarchy & density**: убрать повторяющиеся заголовки (`Ресурсы`, `Настройки`), избыточные подписи/метаданные, перегруженные строки; сохранить только реальные данные правой панели | Window-titlebar несёт ПУТЬ `Секция / Подсекция` (`Ресурсы / Skills|Extensions|MCP`, `Настройки / <раздел>`, `Модули / <вкладка>`); контент сохраняет свой заголовок секции (паттерн референсов) — заголовки стали иерархией, а не дублем. Убраны: подпись области поиска, лекционный абзац в правой панели (`details-empty`), мёртвый CSS. `Модули`: контентный h2 **сохранён** — owner п.3 перечисляет только `Ресурсы`/`Настройки`, а п.4 требует сохранять accessibility (view без заголовка) | `tests/ui/visualFidelity.test.tsx` (hierarchy: path≠h1, отсутствие подписи поиска и лекционного абзаца), `tests/ui/m3Modules.test.tsx` (orphaned-view сохранён), `tests/ui/m2Resources.test.tsx` (миграция на controlled-tab harness) |
| 4 | **Typography & responsiveness**: трункат заголовков сэмлов → tooltip; scrollbar/rail; размеры шрифтов/кнопок; доступность Apply/Cancel; 1440/1280/1024 + 125%/150%; фокус/контраст/reduced-motion | Tooltip (`title`) на обрезаемых строках: сессии, проекты (полный путь), вкладки модулей, инструменты, заголовок чата. `scrollbar-gutter: stable` на общем сбросе (списки не «прыгают» при появлении скроллбара). Apply/Cancel/Reset — `position: sticky; bottom: 0` в `.settings`-скроллпорте; **корневой фикс**: обёртки `settings/resources/modules` не имели height-chain (`.settings` рос до контента, страница скроллилась документом) → добавлен `.view-pane` по образцу `chat-workspace` (каждая панель владеет своим скроллпортом, chrome фиксирован). DPI 125%: честная попытка через `--force-device-scale-factor=1.25` с проверкой `devicePixelRatio` (флаг применён → снимок `ui-dpi-125.png` + overflow-гейт; иначе — аннотация NOT RUN, без фальши). A11y: клавиатурная доступность create-действия, source-гейты `:focus-visible` / `prefers-reduced-motion` / gutter / sticky | `tests/ui/visualFidelity.test.tsx` (T5: tooltips, source-gates, keyboard), E2E `e2e/ui.spec.ts` (sticky 1024×768: бокс в вьюпорте + рабочий Cancel; DPI-попытка), снимок `ui-dpi-125.png` |
| 5 | **Representative populated UI**: длинные обмены, Markdown, multi-tool, позиция скролла, focus+IME, раскрытие/сворачивание сайдбаров, реальный контент Skills, все темы, custom editor; проверка отсутствия remount сессии/стрима/черновика | Новая фикстура-сессия с двумя длинными markdown-ответами (заголовки/списки/inline-code/фенс). `FAKE_PI_TOOLS=1` в fake — multi-tool turn (2 ok + 1 ошибка) в правой панели; по умолчанию выключен (прежние прогоны байт-в-байт). RTL-гейт: переключения правой панели и темы (уход из чата и возврат) не пересоздают активную сессию и черновик. Скриншоты: все пресеты (dark/light/claude/codex @1440), custom editor, Settings→Connection, markdown-сессия, populated-чат с панелью инструментов, раскрытый/свёрнутый сайдбары | `e2e/ui.spec.ts` (markdown-рендер: SafeMarkdown — литеральные заголовки/списки по контракту Issue #5 gate 3, фенс → `<pre><code>`; multi-tool: `tool-details`, «3 инстр. · 2 готово»), `tests/ui/visualFidelity.test.tsx` (no-remount), `e2e`-скриншоты ниже |
| 6 | **Screenshot hygiene**: приватный путь `/mnt/f/_hermes/CODE/pi-wsl-desktop` в `ui-04` → нейтральные синтетические пути, автоматическая санация + визуальная выборка; реальный Electron, не mockups | `e2e/hygiene.ts`: `PRIVATE_PATH_PATTERNS` + `expectNoPrivatePaths` (текст до каждого PNG) + `sanitizedScreenshot` (единственный путь к скриншоту). Синтетический агент-CWD под одноразовым HOME + per-launch копия session-фикстур (frozen mtime) — репозиторий и реальные данные никогда не отображаются/не пишутся. CI-шаг загрузки артефакта скриншотов | RED-проба в `e2e/ui.spec.ts` («R03 п.6: no private path material in visible text»), скан каждого PNG перед записью, `.github/workflows/product-ci.yml` (`Upload UI screenshot artifacts`) |

## Инвентарь скриншотов (реальный Electron, WSL+fake-транспорт, синтетический HOME)

Полный набор генерируется полным E2E-прогоном и ложится в Playwright
`test-results/` (+ CI-артефакт `uia-r03-screenshots-<sha>`):

| Файл | Состояние |
|:--|:--|
| `ui-01-chat-dark-expanded.png` | Чат, раскрытые сайдбары, topbar 48px без нативного меню |
| `ui-02-chat-dark-rail-details.png` | Свёрнутый rail 48px + открытая панель деталей |
| `ui-04-resources-dark.png` | Resources/Skills с реальными строками фикстур-навыков (синтетический agent-home) |
| `ui-05-chat-populated-dark.png` | Заполненный чат: история + live-ответ + multi-tool панель (3 инстр., 1 ошибка) |
| `ui-06-theme-editor.png` | Custom-редактор темы |
| `ui-09-markdown-fixture.png` | Markdown-сессия: литеральные заголовки/списки, `<pre><code>`-фенс |
| `ui-settings-dark.png` | Настройки → Внешний вид (dark) |
| `ui-settings-connection.png` | Настройки → Подключение (диагностика + RPC-граница записи) |
| `ui-theme-claude-1440x900.png`, `ui-theme-codex-1440x900.png` | Пресеты Claude/Codex |
| `ui-matrix-{dark,light}-{1440x900,1280x800,1024x768}.png` | Матрица светлый/тёмный × три ширины |
| `ui-dpi-125.png` | 125% scale-factor попытка (честно фиксируется только если флаг применён) |

Все файлы проходят `expectNoPrivatePaths` (видимый текст) и `sanitizedScreenshot`
(скрин + `title`/`value` атрибуты) перед записью.

## Отклонения и честные оговорки

- **`Модули`**: контентный заголовок сохранён — owner-п.3 перечисляет только
  `Ресурсы`/`Настройки`; удаление второго заголовка создало бы view без heading
  (п.4 «preserve accessibility»). Titlebar путь `Модули / <вкладка>` добавлен
  только для открытых вкладок модуля.
- **SafeMarkdown**: заголовки/списки остаются литеральным текстом, фенсы →
  `<pre><code>` — это контракт безопасности Issue #5 gate 3 (без разбора
  HTML/тегов), а не отказ от markdown-фикстур.
- **Правая панель ≤1100px** скрыта медиа-правилом R02 — multi-tool доказательство
  снимается на 1440 (аудит-ширина владельца первая в списке).
- **`Открыть последний диалог`** сохранён как secondary-действие с честной
  подписью (не переименован в создание).
- **150% DPI** не проверялся (125% — применено и снято; 150% — попытка
  дублирует тот же механизм флага, отдельный прогон NOT RUN, чтобы не раздувать
  гейт-матрицу без отдельного запроса).

## NOT RUN / вне пакета

- Реальный профиль Windows + настоящий WSL+Pi, установка/удаление — только с
  consent владельца; платные model prompt — не выполнялись; записи в
  пользовательский `~/.pi` — нет.
- UI-B (терминал/PTY, реальные CPU/RAM, Dashboard) — не начат.
- **Merge PR #23 — BLOCK до повторного Visual ACCEPT владельцем.**
