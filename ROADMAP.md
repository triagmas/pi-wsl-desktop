# 🗺️ Pi WSL Desktop — ROADMAP

> **Актуальный статус проекта и журнал принятых результатов.**  
> GitHub Issues описывают задачи, Pull Requests подтверждают реализацию, а **этот файл в `main` показывает фактически выполненную работу**.

[📘 Продукт](PRODUCT.md) · [🛠️ Спецификация](SPECIFICATION.md) · [🤖 Правила для Pi](AGENTS.md) · [🎯 Roadmap Issue #1](https://github.com/triagmas/pi-wsl-desktop/issues/1)

**Цель:** Pi WSL Desktop 1.0 · **Статус:** Bootstrap и M0 приняты и слиты · M1 готовится к разработке · **Разработка:** крупными тематическими пакетами и PR.

---

## 📍 Состояние этапов

| Этап | Состояние | Основание | Приёмка |
|:--|:--|:--|:--|
| **Bootstrap — контракты** | ✅ Принято | [PR #3](https://github.com/triagmas/pi-wsl-desktop/pull/3) merged 2026-10-19 (`877a573`) | Merge выполнен владельцем |
| **M0 — Foundation & WSL Bridge** | ✅ Принято | [Issue #2](https://github.com/triagmas/pi-wsl-desktop/issues/2) closed · [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) merged 2026-10-19 (`1c24cf23`) | [ACCEPT](https://github.com/triagmas/pi-wsl-desktop/pull/4#pullrequestreview-5568765644) · merge владельца |
| **M1 — Sessions & Chat** | 🟡 Подготовка (код ещё не предъявлен) | [Issue #5](https://github.com/triagmas/pi-wsl-desktop/issues/5) · стартовая ветка `feat/m1-sessions-chat-r01` | Реализация и приёмка впереди |
| **M2 — Pi Manager** | ⬜ Запланирован | Будущий Issue | — |
| **M3 — Module System** | ⬜ Запланирован | Будущий Issue | — |
| **M4 — Desktop 1.0** | ⬜ Запланирован | Будущий Issue | — |

**Легенда:** ⬜ запланировано · 🟡 в работе / на ревью · ✅ принято · ⛔ заблокировано. Статус «✅ принято» требует завершённой приёмки, а не только заявления разработчика.

## ✅ Выполненные организационные задачи

- [x] Создан [публичный репозиторий](https://github.com/triagmas/pi-wsl-desktop).
- [x] Настроена [защита main](https://github.com/triagmas/pi-wsl-desktop/rules/25366026): запрет удаления, force push и обязательный PR.
- [x] Создан [управляющий Issue #1](https://github.com/triagmas/pi-wsl-desktop/issues/1) и первый [макропакет Issue #2](https://github.com/triagmas/pi-wsl-desktop/issues/2).
- [x] **Приняты** документы `PRODUCT.md`, `SPECIFICATION.md`, `AGENTS.md` и данный `ROADMAP.md` через [PR #3](https://github.com/triagmas/pi-wsl-desktop/pull/3) (merged 2026-10-19, `877a573`).
- [x] **Принят** безопасный [Repository Contract CI](.github/workflows/repository-contract.yml) в PR #3 (только документация и правила учёта, **не** тесты продукта).

> **Важно:** наличие файлов в Draft PR — не выполненный этап. Отметки выше поставлены только после фактического merge PR #3. Нельзя засчитывать несмерженный код.

## 🧱 M0 — Foundation & WSL Bridge

**Цель:** безопасно подключиться из Windows к существующему Pi в Ubuntu WSL2. [Техническое задание #2](https://github.com/triagmas/pi-wsl-desktop/issues/2).

> **Приёмка M0 завершена:** независимое ревью [ACCEPT](https://github.com/triagmas/pi-wsl-desktop/pull/4#pullrequestreview-5568765644), пользователь разрешил merge, [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) слит 2026-10-19 (`1c24cf23`). Все семь пунктов ниже отмечены `[x]` на основании принятого результата. Реальные Windows+WSL smoke зафиксированы по отчёту разработчика, автоматический CI подтверждён GitHub.

- [x] Электронная оболочка с минимальным React UI и диагностикой окружения. — *принято в PR #4*: Playwright E2E 4/4 (настоящее окно, contextIsolation/sandbox-доказательство, ready, error+retry и ready-gate `PI_NOT_FOUND`/`PI_INCOMPATIBLE`), UI RTL 6/6, отсутствие вечного спиннера подтверждено тестом.
- [x] Типизированный и версионированный контракт Desktop ↔ Bridge с идентификаторами запросов. — *выполнено в PR*: `src/shared/protocol.ts` (Zod, `protocolVersion=1`, `requestId`, строгие кадры, лимит 1 МиБ), contract 13/13.
- [x] Один устойчивый WSL Bridge: запуск, остановка, health, тайм-ауты, восстановление. — *выполнено в PR*: свежие интеграционные тесты 46/46 (timeout/cancel/crash/oversize/invalid-frames/reconnect/no-write), state-machine unit regression tests, `close()` без сиротских процессов.
- [x] Обнаружение установленного Pi/Node в WSL с нестандартным `PATH`, без повторной установки. — *выполнено в PR*: probe unit regression tests (включая `~/.local/bin`, `#!/usr/bin/env node` и строгий override), UTF-16LE-парсер на реальной фикстуре `wsl.exe`; реальный smoke: node найден в `~/.local/bin`.
- [x] Согласование фактических команд Pi RPC/SDK с установленной версией. — *выполнено в PR*: реальный smoke — Pi `1.3.0`, **RPC advertised by `--help`** (не handshake); негативные тесты `PI_NOT_FOUND` / `PI_INCOMPATIBLE`.
- [x] Unit, Contract, Integration, UI и реальный Windows+WSL smoke — доказательства в PR. — *выполнено в PR*: Vitest 139 PASS / 5 SKIP (smoke-env), E2E 4/4 PASS, WSL-side smoke 4/4 PASS, Windows GUI smoke PASS (fail-closed ownership-планировщик: decoy-survived + own-stopped, 0 непроверенных kill).
- [x] Приёмка M0 независимым ревьюером и владельцем продукта. — [ACCEPT](https://github.com/triagmas/pi-wsl-desktop/pull/4#pullrequestreview-5568765644), разрешённый владельцем squash merge [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) → `main` `1c24cf23157aa8e289ab67e7a8e26729d62f06d3`; [Issue #2](https://github.com/triagmas/pi-wsl-desktop/issues/2) закрыт как completed.

## 💬 M1 — Sessions & Chat

- [ ] Список проектов и реальных сессий Pi по доступным каталогам.
- [ ] Чтение истории без изменения оригинальных JSONL.
- [ ] Продолжение старой сессии через официальный Pi RPC/SDK.
- [ ] Потоковые ответы, события инструментов, модель/контекст, отмена.
- [ ] Корректная конкурентность CLI/GUI, ошибки чтения и восстановление.
- [ ] Unit/Contract/Integration/E2E и реальные Windows+WSL тесты приняты.

## 🧰 M2 — Pi Manager

- [ ] Инвентаризация Skills с источниками и состояниями.
- [ ] Управление Skills и Extensions средствами существующего Pi в WSL.
- [ ] Управление глобальными/проектными MCP, диагностика и OAuth там, где поддерживается.
- [ ] Trust-гейты, подтверждения операций записи, rollback/отсутствие потерь.
- [ ] Результаты из GUI совпадают с проверкой непосредственно в Pi CLI.
- [ ] Тесты установки/отключения/ошибок и приёмка M2.

## 🧩 M3 — Module System

- [ ] Версионированный манифест модуля и capability API.
- [ ] Регистрация/отключение модулей UI без изменения ядра.
- [ ] Изоляция ошибок и проверка совместимости модулей.
- [ ] Контрактные тесты и приёмка M3.

## 🚀 M4 — Desktop 1.0

- [ ] Установка, обновление и удаление Windows-приложения без потери Pi-сессий.
- [ ] Регрессионная матрица Windows+WSL: повторное подключение, воспроизводимость, безопасность.
- [ ] Проверка лицензий, секретов, сборки и пользовательской документации.
- [ ] Release 1.0 с подтверждёнными артефактами и результатами тестов.

---

## 📒 Журнал принятых результатов

| Дата | Задача / этап | Подтверждение | Итог |
|:--|:--|:--|:--|
| 2026-10-19 | Инициализация GitHub и настройка защиты `main` | [Репозиторий](https://github.com/triagmas/pi-wsl-desktop), [Ruleset](https://github.com/triagmas/pi-wsl-desktop/rules/25366026) | ✅ Организационные задачи выполнены |
| 2026-10-19 | Bootstrap-контракты приняты | [PR #3](https://github.com/triagmas/pi-wsl-desktop/pull/3) merged, `877a573` | ✅ Документы и Repository Contract CI приняты merge владельца |
| 2026-10-19 | M0 реализация предъявлена на ревью | [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4), [Issue #2](https://github.com/triagmas/pi-wsl-desktop/issues/2) | 🟡 Vitest 118 PASS / 5 SKIP · E2E 2/2 PASS · WSL smoke 4/4 PASS · Windows GUI smoke PASS · ожидается `ACCEPT` |
| 2026-10-19 | Ревью PR #4: CHANGES REQUIRED → фиксы в той же ветке | [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) (комментарии `6260960975`, `6262065719`) | 🟡 P1 ready-gate (`PI_NOT_FOUND`/`PI_INCOMPATIBLE` до READY) + P1 ownership-cleanup Windows smoke (decoy-survived) + P2 «RPC advertised by help» → Vitest 131 PASS / 5 SKIP · CI Linux+Windows PASS · E2E 4/4 · оба smoke PASS · запрошено повторное ревью |
| 2026-10-19 | Повторное ревью PR #4: CHANGES REQUIRED (safety cleanup) → фиксы | [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) (комментарии `6262312689`, ответ `6262772850`) | 🟡 fail-closed `planCleanup` (0 kill без доказанной идентичности, INCONCLUSIVE→FAIL) + точный cmdline-аргумент → Vitest 139 PASS / 5 SKIP · CI PASS · E2E 4/4 · оба smoke PASS · запрошено следующее ревью |
| 2026-10-19 | ✅ M0 Foundation & WSL Bridge принят и слит | [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) · [ACCEPT review](https://github.com/triagmas/pi-wsl-desktop/pull/4#pullrequestreview-5568765644) · `main` `1c24cf23` · [Issue #2](https://github.com/triagmas/pi-wsl-desktop/issues/2) closed | ✅ 67 файлов, +10 106 / −15; Linux Vitest 139 PASS / 5 SKIP, Electron E2E 4 PASS, Windows 83 PASS / 4 SKIP; Product CI и Repository Contract PASS; реальные WSL 4/4 + Windows GUI smoke PASS — подтверждены отчётом разработчика |
| 2026-10-19 | M1 Sessions & Chat подготовка | [Issue #5](https://github.com/triagmas/pi-wsl-desktop/issues/5) · ветка `feat/m1-sessions-chat-r01` | 🟡 Требования и исходная ветка заведены; код M1 и тесты ещё не реализованы |

*После первого merge добавлять новые строки: дата, задача, ссылка на merged PR, итог / доказательство тестов. Не переносить незавершённые задачи сюда.*

## 🔁 Обязательный порядок обновления ROADMAP

1. **При начале работы:** в ветке PR указать актуальный этап и ссылку на Issue; поставить 🟡 в таблице состояния. Исходная версия в `main` меняется только после merge.
2. **По завершении каждого принятого Issue/подзадачи:** в **том же PR**, который реализует изменение, обновить соответствующий checkbox и состояние этапа. Для итогового принятия этапа — после решения владельца и подтверждения merge, в следующем PR или согласованном финальном обновлении.
3. **Никогда не отмечать `[x]`** только по отчёту агента, локальному коммиту, тесту без подтверждения, открытому PR или предположению. Нужны проверенные результаты и ссылка на GitHub evidence.
4. **В каждом PR** ревьюер проверяет синхронизацию: Issue ↔ код и тесты ↔ чекбоксы `ROADMAP.md` ↔ журнал результатов. Если реализованная задача отсутствует в ROADMAP, добавить её до merge.
5. **При несогласованности** ROADMAP и GitHub не угадывать: отметить `BLOCKED`, проверить исходный merged PR и восстановить верный статус.
6. Запрещается удалять выполненные пункты при реорганизации; переносить их в историю со ссылкой, сохраняя трассируемость.

### Условия приёмки любого большого PR

- [ ] Все обязательные применимые Skills найдены, загружены и применены; отчёт содержит список фактически использованных Skills.
- [ ] TDD: продемонстрирован тест, обнаруживающий дефект/отсутствие функции до реализации, и повторный PASS после.
- [ ] Unit/Contract/Integration/UI/E2E, релевантные этапу, имеют числовые результаты PASS/FAIL/SKIP.
- [ ] Реальная Windows+WSL проверка задокументирована как PASS/FAIL/NOT RUN.
- [ ] Дифф, список файлов, строки **`+/-`**, риски и rollback раскрыты.
- [ ] Изменение статусов и чекбоксов в `ROADMAP.md` соответствует фактической приёмке.
- [ ] Владелец продукта явно утвердил merge.

> Контрольный принцип: **GitHub PR/коммиты — доказательство, ROADMAP.md — читаемая сводка, Issues — постановка задач.**
