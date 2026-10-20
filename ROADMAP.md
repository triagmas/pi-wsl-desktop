# 🗺️ Pi WSL Desktop — ROADMAP

> **Актуальный статус проекта и журнал принятых результатов.**  
> GitHub Issues описывают задачи, Pull Requests подтверждают реализацию, а **этот файл в `main` показывает фактически выполненную работу**.

[📘 Продукт](PRODUCT.md) · [🛠️ Спецификация](SPECIFICATION.md) · [🤖 Правила для Pi](AGENTS.md) · [🎯 Roadmap Issue #1](https://github.com/triagmas/pi-wsl-desktop/issues/1)

**Цель:** Pi WSL Desktop 1.0 · **Статус:** Bootstrap, M0 и M1 приняты и слиты · M2 готовится к разработке ([Issue #7](https://github.com/triagmas/pi-wsl-desktop/issues/7)) · **Разработка:** крупными тематическими пакетами и PR.

---

## 📍 Состояние этапов

| Этап | Состояние | Основание | Приёмка |
|:--|:--|:--|:--|
| **Bootstrap — контракты** | ✅ Принято | [PR #3](https://github.com/triagmas/pi-wsl-desktop/pull/3) merged 2026-10-19 (`877a573`) | Merge выполнен владельцем |
| **M0 — Foundation & WSL Bridge** | ✅ Принято | [Issue #2](https://github.com/triagmas/pi-wsl-desktop/issues/2) closed · [PR #4](https://github.com/triagmas/pi-wsl-desktop/pull/4) merged 2026-10-19 (`1c24cf23`) | [ACCEPT](https://github.com/triagmas/pi-wsl-desktop/pull/4#pullrequestreview-5568765644) · merge владельца |
| **M1 — Sessions & Chat** | ✅ Принято | [Issue #5](https://github.com/triagmas/pi-wsl-desktop/issues/5) closed · [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) merged 2026-10-20 (`6b3b9c03`) | [ACCEPT ревью](https://github.com/triagmas/pi-wsl-desktop/pull/6#pullrequestreview-5580577901) · squash merge владельца; real write/model prompt **NOT RUN** |
| **M2 — Pi Manager** | 🟡 Подготовка (код M2 ещё не реализован) | [Issue #7](https://github.com/triagmas/pi-wsl-desktop/issues/7) · ветка `feat/m2-pi-manager-r01` (вкл. отложенный M1-hardening P2#2/P2#3) | M1 уже принят; TDD и приёмка M2 впереди |
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

> **M1 принят и слит 2026-10-20:** [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) → `main` `6b3b9c03f74e49df2052d668c5453bb93645622b`, [независимый ACCEPT](https://github.com/triagmas/pi-wsl-desktop/pull/6#pullrequestreview-5580577901), [Issue #5](https://github.com/triagmas/pi-wsl-desktop/issues/5) закрыт как `completed`. Итоги: Linux Vitest **274 PASS / 8 SKIP**, Electron E2E **7 PASS**, Windows unit/contract **170 PASS / 4 SKIP**, оба CI **PASS**. Реальные `REAL_PI` 3/3, `REAL_WSL` 4/4 и Windows GUI smoke PASS — по отчёту Pi-разработчика, независимо не воспроизводились. Реальный prompt/model-call и запись в тестовую Pi-сессию **NOT RUN**, требуют отдельного согласия владельца; это не выдано за подтверждённый функциональный smoke.

- [x] Список проектов и реальных сессий Pi по доступным каталогам. — *принято в PR #6*: индекс по реальным каталогам (`src/bridge/sessions.ts`: проекты из header-`cwd`, коллизии кодировок, пустые/битые/недоступные файлы, activeWrite-эвристика) — unit 12/12 + integration 5/5; E2E-discovery ✓.
- [x] Чтение истории без изменения оригинальных JSONL. — *принято в PR #6*: ограниченный read-only парсер (`sessionReader`: дерево parentId, легаси v1/v2, partial-trailing, corrupt-строки с номерами, пагинация) — unit 14/14 + integration 5/5 c sha256+mtime; реальный smoke: no-mutation против настоящего store.
- [x] Продолжение старой сессии через официальный Pi RPC/SDK. — *принято в PR #6*: `ChatSessionManager` спавнит `pi --mode rpc --session <path>` с cwd сессии (запись только официальным API) — unit 16/16, сквозная интеграция через настоящий bridge, E2E-resume ✓; изолированный живой handshake реальной Pi 1.3.0 (без model-call) в смоукe.
- [x] Потоковые ответы, события инструментов, модель/контекст, отмена. — *принято в PR #6*: `PiRpcClient` (id-корреляция, `agent_settled`, epoch-гонки, oversize/краш) unit 16/16 + реальный subprocess-интеграл 10/10; UI: delta-стрим до `message_end`, чипы инструментов, кнопка Прервать — RTL 24/24, E2E стрим+interrupt ✓.
- [x] Корректная конкурентность CLI/GUI, ошибки чтения и восстановление. — *принято в PR #6*: `SESSION_CONFLICT` (окно активной записи + внешняя запись в idle → prompt НЕ отправляется), `RESOURCE_BUSY` (один слот), `SESSION_NOT_FOUND`, fail-closed таймауты, readiness-deadline `BRIDGE_TIMEOUT` (без вечного спиннера), recovery-состояния — unit/integration/E2E включая реальный E2E-конфликт ✓.
- [x] Unit/Contract/Integration/E2E и реальные Windows+WSL тесты приняты. — *принято в PR #6 (с оговоркой о write/model-call NOT RUN)*: Vitest **274 PASS / 8 SKIP** (8 = env-gated реальные смоуки), E2E 7/7, Product CI + Repository Contract PASS (по логам: Linux 274/8, Windows 170/4); реальные прогоны: `REAL_PI` 3/3, `REAL_WSL` 4/4, Windows GUI smoke PASS; write-упражнение и model-call — **NOT RUN** (нет авторизации владельца). Ревью: итерации 1–2 CHANGES REQUIRED → исправлены, **итерация 3 ACCEPT (`4fb2260`)** + **delta review ACCEPT (`779100c`)**; squash merge разрешён владельцем и выполнен (`6b3b9c03`).

## 🧰 M2 — Pi Manager

- [ ] Инвентаризация Skills с источниками и состояниями.
- [ ] Управление Skills и Extensions средствами существующего Pi в WSL.
- [ ] Управление глобальными/проектными MCP, диагностика и OAuth там, где поддерживается.
- [ ] Trust-гейты, подтверждения операций записи, rollback/отсутствие потерь.
- [ ] Результаты из GUI совпадают с проверкой непосредственно в Pi CLI.
- [ ] Тесты установки/отключения/ошибок и приёмка M2.
- [ ] Отложенный M1-hardening из [Issue #7](https://github.com/triagmas/pi-wsl-desktop/issues/7): **P2#2** fail-closed realpath-политика для `assertInsideRoots` (симлинк-тесты: escape/легитимный in-root/смена цели, без чтения наружу) и **P2#3** byte-safe UTF-8 граница `readTail` в display-name — с регрессиями; severity повышать сразу при подтверждённой эксплуатации.
- [ ] Условный write/prompt smoke (сейчас **NOT RUN** — только с отдельного разрешения владельца) как gate перед production-grade Chat; без тестов на реальных пользовательских сессиях.

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
| 2026-10-19 | M1 Sessions & Chat реализация предъявлена на ревью | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) · [Issue #5](https://github.com/triagmas/pi-wsl-desktop/issues/5) | 🟡 Vitest 262 PASS / 8 SKIP · E2E 7/7 · Product CI (Linux+Windows) PASS · REAL_PI smoke 3/3 PASS · REAL_WSL 4/4 PASS · Windows GUI smoke PASS · write/model-call NOT RUN (без авторизации) · ожидается `ACCEPT` |
| 2026-10-19 | Ревью PR #6: CHANGES REQUIRED → фиксы в той же ветке | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) (ревью фреш-контекста, диапазон `1c24cf23..9190102`) | 🟡 [IMPORTANT] байтовая точность UTF-8 на границе 64-КиБ чанков (`readRange`→Buffer, reader+search, RED с граничными фикстурами) + позиционный `L<line>` курсор для id-less страниц + path-гейт session roots (INVALID_REQUEST) + E2E RESOURCE_BUSY + очистка orphan-таймеров + строка статуса ROADMAP → Vitest 267 PASS / 8 SKIP · E2E 7/7 · REAL_PI 3/3 · REAL_WSL 4/4 · Windows GUI PASS · запрошено повторное ревью |
| 2026-10-19 | Повторное ревью PR #6 (итерация 2): CHANGES REQUIRED → фиксы | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) (ревью диапазона `1c24cf23..e82e7a3`; все 6 фиксов раунда 3 подтверждены) | 🟡 [IMPORTANT] хронология пагинации истории: continuation-страницы клались ВПЕРЁД и подписывались «ранее» при строго-вперёд-курсоре ридера (для сессий >100 записей хронология перемешивалась) → чистая `mergeHistoryPage` + кнопка «Загрузить продолжение» + перевёрнутый RTL-мок + seam-тест с реальным ридером (120 записей, RED через мутацию prepend); [MINOR] byte-декод probe/wsl-потоков, нормализация обоих сторон session-root, документация `L<line>`-курсора и `partialTrailing`, ROADMAP 267→270 → Vitest 270 PASS / 8 SKIP · E2E 7/7 · REAL_PI 3/3 · REAL_WSL 4/4 · Windows GUI PASS · запрошено следующее ревью |
| 2026-10-19 | Ревью PR #6 (итерация 3): **ACCEPT** | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) (диапазон `1c24cf23..4fb2260`; ответ `6279828424`) | ✅/🟡 12/12 замечаний итераций 1–2 закрыты (файл:строка), новых BLOCKER/IMPORTANT нет, 7 TDD-гейтов Issue #5 PASS (гейт 4 — статически + прогонами супервизора); report-only: P2 диагностика merge-страниц (мини-фикс — по решению владельца), P2 симлинки `assertInsideRoots` и граница `readTail` — перенос в M2; код принят на точном HEAD `4fb2260`, пост-ACCEPT коммиты только документационные · ожидается явное согласие владельца на merge |
| 2026-10-20 | Technical disposition владельца → фикс P2#1 в PR #6 (TDD) | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) (`6280173991`, фикс `9411896`) | 🟡 `mergeHistoryPage` теперь сохраняет диагностику ВСЕХ загруженных страниц (append, дедуп по line+error, cap `MAX_READ_DIAGNOSTICS` общий для reader/renderer; контракт пагинации/порядок/JSONL не менялись): RED 2/4 → GREEN 4/4 (`tests/unit/historyMerge.test.ts`), seam/UI-тесты зелёные · Vitest **274 PASS / 8 SKIP** (CI Linux), Windows unit+contract **170/4** (по логам), E2E 7/7, tc/lint/build 0/0/0, REAL_PI 3/3, REAL_WSL 4/4, Windows GUI PASS · P2#2/P2#3 закреплены в [Issue #7](https://github.com/triagmas/pi-wsl-desktop/issues/7) и ROADMAP M2 · тело PR синхронизировано · запрошено delta review нового HEAD |
| 2026-10-20 | Delta review нового HEAD: **ACCEPT** | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) (диапазон `4fb2260..779100c`, комментарий `6280641448`) | ✅ P2#1 закрыт корректно по TDD (RED-воспроизводимость кейсов 1/3 арифметикой фикстур подтверждена; кейсы 2/4 — честно guard-тесты), поведенческих регрессий нет, состав delta — ровно 5 файлов (ROADMAP + 3 код-модуля + 1 тест, `git diff --stat 4fb2260..779100c` = +115/−7), числа 274/8 · 146/28/76/24 и 170/4 сходятся статически; P2-мелочь ROADMAP:58 (270→274) исправлена в этом docs-коммите · merge — по явному согласию владельца |
| 2026-10-20 | ✅ M1 Sessions & Chat принят и слит | [PR #6](https://github.com/triagmas/pi-wsl-desktop/pull/6) · [ACCEPT](https://github.com/triagmas/pi-wsl-desktop/pull/6#pullrequestreview-5580577901) · `main` `6b3b9c03` · [Issue #5](https://github.com/triagmas/pi-wsl-desktop/issues/5) closed | ✅ 56 файлов, +6 440 / −100; Linux Vitest 274 PASS / 8 SKIP, Electron E2E 7 PASS, Windows 170 PASS / 4 SKIP, два CI PASS; REAL_PI 3/3, REAL_WSL 4/4, native Windows GUI PASS по отчёту Pi; **write/model-call NOT RUN**; P2#2/P2#3 → [Issue #7](https://github.com/triagmas/pi-wsl-desktop/issues/7) |
| 2026-10-20 | M2 Pi Manager — подготовка | [Issue #7](https://github.com/triagmas/pi-wsl-desktop/issues/7) · ветка `feat/m2-pi-manager-r01` | 🟡 После принятия M1 открыта стартовая ветка; реализация, TDD и смоук M2 ещё впереди |

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
