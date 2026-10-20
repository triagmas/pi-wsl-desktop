# План M1 — Sessions & Chat (feat/m1-sessions-chat-r01, PR #6)

**Дата:** 2026-10-19 · **Issue:** #5 · **База:** `main` `1c24cf23` (M0 принят), ветка `feat/m1-sessions-chat-r01` @ `967e1cb`
**Исполнение:** inline (executing-plans), строгий Red→Green→Refactor, ledger: `.superpowers/sdd/2026-10-19-m1-sessions-chat/progress.md`

## Цель

Показать реальные проекты/сессии установленного Pi в WSL, безопасно читать историю (read-only, байты+mtime неизменны) и продолжать диалог через официальный Pi RPC 1.3.0 с корректной политикой конкурентности CLI/GUI. Один связный PR #6, без merge.

## Авторитетные факты research-фазы (установленная Pi 1.3.0, из её же docs/)

1. **RPC:** JSONL stdin-команды `{"id"?, "type": <command>, ...}`; stdout: `{"id","type":"response","command","success","data"|"error"}` + асинхронные события (`agent_start/end/settled`, `turn_*`, `message_start/update/end`, `tool_execution_*`, `queue_update`, `compaction_*`, `auto_retry_*`, `extension_error`) + `extension_ui_request` (диалоги блок до `extension_ui_response`; fire-and-forget `notify/setStatus/setWidget/…` можно игнорировать). Parse-ошибка → response без id (`command:"parse"`).
2. **Framing:** строгий LF (не readline — U+2028/2029 валидны внутри JSON); читать stdout непрерывно (backpressure); stderr = диагностика, не протокол; закрытие stdin = аккуратный shutdown.
3. **Run lifecycle:** `prompt` → `disposition` started|queued|handled (принят ≠ готов!); подписка ДО prompt; финал = `agent_settled` (не `agent_end`); при стриминге обязателен `streamingBehavior: steer|followUp`, иначе ошибка; **не переотправлять prompt после обрыва** (нет двойной генерации).
4. **Команды M1:** `get_state` (sessionId, sessionFile — отсутствует при `--no-session`, isStreaming, isCompacting, messageCount), `switch_session {sessionPath}` → `{cancelled}`, `abort` (ждёт idle), `get_entries {since?}` (курсор по id, `leafId`; неизвестный since → success:false), `get_tree`, `get_session_stats`, `prompt`, `clear_queue`.
5. **Сессии:** `~/.pi/agent/sessions/--<enc-cwd>--/<ISO>_<uuid>.jsonl`, где enc: ведущий `/` убирается, `/`,`\`,`:` → `-` (коллизии возможны → авторитет = `cwd` из header). Header — строка 1: `{type:"session",version:1|2|3,id,timestamp,cwd,parentSession?}`. v1 линейная (auto-migrate при загрузке SessionManager — **превью обязано парсить само**), v2 дерево `id/parentId`, v3 роли `custom`. Записи: `message|model_change|thinking_level_change|usage|compaction|context_edit|branch_summary|custom|custom_message|label|session_info`. Роли сообщений: system/user/assistant/toolResult/bashExecution/custom/branchSummary/compactionSummary; content blocks: text/image/thinking/toolCall.
6. **Переопределения:** `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > настройка `sessionDir`; `PI_CODING_AGENT_DIR`; `--session <path|id>`; `--no-session`; `--offline`.
7. **Изолированный handshake доказан вручную:** `HOME=$TMP pi --mode rpc --no-session --offline` → `get_state`+`get_session_stats` success, stderr пуст, exit 0 на закрытии stdin, во временном HOME создаются только `models-store.json`/`auth.json`, **ни одной model-call**.
8. **Реальная машина:** 5 bucket-каталогов, 49 сессий, все header v3 (16/16 в верхнем уровне); рядом — вложенные `…/<uuid>/run-0/session.jsonl` и `subagent-artifacts/*.jsonl` (НЕ индексировать: внутренние транскрипты, не resume-сессии); активные параллельные pi-процессы другой работы пишут сессии ⇒ real smoke обязан терпеть конкурирующие добавления (partial trailing line — реальное условие).

## Архитектура

```
renderer (tabs: Статус | Сессии)
  SessionsView: Projects → Sessions → [История | Чат]
   SafeMarkdown (inert HTML, без dangerouslySetInnerHTML)
        ↕ contextBridge (расширенный whitelist M0+M1)
preload → IPC (двукратный allowlist) → main
   connection (M0) + m1: события chat → renderer
        ↕ NDJSON bridge (M0 protocol + event 'chat')
src/bridge:
  sessions.ts   — индекс проектов/сессий (FsLike-инъекция, header-first)
  sessionReader.ts — read-only потоковый JSONL-парсер (ограниченная память)
  piRpcClient.ts — subprocess Pi RPC (корреляция, стрим до agent_settled, abort)
  chatSession.ts — один слот чата, write-boundary политики
  handlers.ts   — M1 методы + подписки событий
```

**Ключевые решения:**
- **Проекты = `cwd` из header** (не имя каталога); bucket-декодинг только fallback; коллизии кодировок → раздельные проекты по header.
- **Превью только наш парсер** (fs open 'r', никогда не спавним pi для чтения) ⇒ миграция невозможна по построению; proof = sha256+mtime до/после в тестах.
- **Активная запись:** эвристика `now - mtime <= ACTIVE_WRITE_WINDOW_MS` (default 10s) → флаг `activeWrite`; `openSession` при флаге → `SESSION_CONFLICT` (предложение read-only/CLI); повторная проверка перед каждым `sendPrompt` (изменение файла → конфликт, prompt НЕ отправляется → нет двойной генерации).
- **Один активный чат на bridge** → второй `openSession` → `RESOURCE_BUSY` (протестированная политика).
- **Resume:** spawn `pi --mode rpc --session <path>` с cwd = header cwd (официальная загрузка, включая легальную миграцию — только по явному действию пользователя).
- **Extension UI:** fire-and-forget игнорируем; диалоги → авто-`{cancelled:true}` (M1: не зависать; расширения — M2) — документируется.
- **События:** bridge шлёт event-файмы `{v:1,type:'event',event:'chat',payload}` (нормализованный subset: stream deltas, tool start/end, settled, error) → main → renderer; подписка через запрос, писать без подписки нельзя.
- **Приватность:** реальные пути/контент — только локально; фикстуры синтетические; в публичный CI/PR — ничего из `~/.pi`.

## Задачи (каждая: RED → GREEN → commit)

1. **T1 Контракты M1:** `src/shared/m1Protocol.ts` (Zod: listProjects/listSessions/readSession/searchSessions/openSession/sendPrompt/interrupt/getState результаты+параметры, chat-event payload, activeWrite/availability/error-диагностика), `M1_METHODS`, `isAllowedRendererMethod` = M0∪M1 (комментарий о write-границе), event-фрейм в `protocol.ts`. Contract-тесты.
2. **T2 Индекс сессий:** `src/bridge/sessions.ts` — roots (env→settings→default), обход bucket'ов (только верхнеуровневые `*.jsonl`), header-чтение (bounded), проекты по cwd, fallback-декод коллизий, сортировки, пустые/битые/без прав, activeWrite, диагностика. Unit (FsLike-фейк) + integration (temp dirs, chmod).
3. **T3 Read-only reader:** `src/bridge/sessionReader.ts` — чанковый LF-парсер (cap линии, cap байт), partial trailing, corrupt-строки с номерами, unknown-типы (opaque), дерево parentId + активный leaf, v1-цепочка, пагинация по `sinceEntryId`+limit, `partialTrailing`-флаг. Unit+integration: sha256+mtime до/после, legacy v1/v2 фикстуры (синтез по docs — на машине research только v3), конкурирующий append (дописываем половину строки ПОСЛЕ открытия).
4. **T4 Поиск:** `searchSessions` metadata (name/cwd/path) vs content только при явном `includeContent` (диагностика переполнения выборки). Unit.
5. **T5 PiRpcClient:** `src/bridge/piRpcClient.ts` — spawn/cwd/args, LineAssembler (16MiB cap), id-корреляция, события → подписчики, prompt→disposition→`agent_settled`-примитив `promptAndWait`, abort, тайм-ауты, краш/reconnect-события, extension_ui (fire-and-forget ignore, диалог→cancel), **нет авто-replay**. Integration против `tests/fixtures/fake-pi-rpc` (режимы: hang/crash/malformed/oversize/delay/partial-unicode) + `REAL_PI=1` изолированный handshake (smoke, env-гейт).
6. **T6 Bridge M1 handlers + политики:** openSession (write-boundary, SESSION_CONFLICT/RESOURCE_BUSY, отсутствует-файл → диагностика), sendPrompt (recheck активности), interrupt=abort+clear_queue?, getState, события chat с подпиской, read-only методы из T2–T4. Integration через настоящий bridge-процесс (fake-wsl/fake-pi-rpc окружение) + no-mutation хеш-тест на реальной фикстуре.
7. **T7 IPC/preload/main:** расширение whitelist ×2, chat event relay, env-хуки (`PI_WS_DESKTOP_SESSION_DIR`, `PI_WS_DESKTOP_ACTIVE_WINDOW_MS`, `PI_WS_DESKTOP_REAL_PI`). Unit (ipc/whitelist) как в M0.
8. **T8 Renderer:** вкладки, ProjectsList/SessionList/SessionDetail(История/Чат), SafeMarkdown, стрим-рендер (delta-буфер + замена по `*_end`/`message_end`), interrupt, состояния conflict/busy/error/recovery/empty, пагинация истории (окно + «загрузить ранее»), no-eternal-spinner. RTL-тесты (~20).
9. **T9 E2E:** фикстурный проект+сессия, чтение сообщений, resume через fake-pi-rpc, стрим, interrupt, изоляция renderer. Playwright.
10. **T10 Реальный smoke:** `tests/smoke/m1Real.test.ts` (гейт `REAL_PI=1`): fingerprint до/после (двойной baseline для активных файлов), list/read реальных сессий (без логирования контента), изолированный handshake, **write-упражнение/модель-вызовы = NOT RUN (нет авторизации владельца)**. Повтор: REAL_WSL smoke M0, native Windows GUI smoke.
11. **T11 CI/docs:** продукт-CI уже гоняет все проекты — убедиться (новые файлы попадают), windows job unit+contract кросс-платформен; ROADMAP M1-аннотации (чекбоксы остаются `[ ]` до ACCEPT) + журнал; план/ledger; PR #6: тело+ответ, Draft→Ready только после всех гейтов.

## Commit-план

По одному коммиту на T1..T10 (RED записан в ledger/тело коммитов; mutation-пробы на ключевых guard'ах reader/policies), затем docs-коммит (ROADMAP+план). Без merge; без перевода Draft→Ready до готовности доказательств.

## Глобальные ограничения

Единственное рабочее дерево; не трогать `~/.pi` (кроме изолированных temp), чужие проекты (voiceforge и др.), Hermes; никаких model-call в тестах/CI/smoke; никаких секретов и реальных путей/контента в коммитах; бесплатные runners; merge только после ACCEPT+решения владельца.

## Review focus (для независимого ревьюера)

Превью действительно не может мутировать оригиналы (построение + хеши)? Write-boundary только через явное действие и официальный API? Нет авто-replay prompt? Конфликты CLI/GUI честно (SESSION_CONFLICT/RESOURCE_BUSY/activeWrite)? Приватность фикстур/CI? Корректность обработки частичных/битых/легаси сессий? Безопасность Markdown и расширения whitelist?
