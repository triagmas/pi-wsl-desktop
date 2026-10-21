# AGENTS.md — Pi WSL Desktop Lite

> Короткие постоянные правила для AI-разработчиков и subagents. Подробные процедуры — в Skills, которые Pi загружает по необходимости. Продукт: [PRODUCT.md](PRODUCT.md) · контракт: [SPECIFICATION.md](SPECIFICATION.md) · прогресс: [ROADMAP.md](ROADMAP.md).

## Источники истины и границы

- **GitHub — источник истины**: статус из актуальных Issues, PR, HEAD, CI и `ROADMAP.md`, не из памяти или собственного отчёта. При конфликте приоритет: принятый PRODUCT → SPECIFICATION → утверждённые Issue/PR.
- Pi WSL Desktop — отдельный Windows UI для **существующего Pi в WSL**. Не переписывать Pi, не дублировать его сессии, настройки и расширения на Windows, не изменять VoiceForge, ChatWake или Hermes.
- **Единственный локальный checkout**: `F:\\_hermes\\CODE\\pi-wsl-desktop` (WSL `/mnt/f/_hermes/CODE/pi-wsl-desktop`). Не создавать копий на C:/E: и не работать прямо в защищённой `main`.
- Владелец отдельно разрешает изменение продуктовых границ, **merge**, реальные записи в пользовательский `~/.pi`, реальные Pi prompts/model calls, внешние MCP connections и платные действия.

## Безопасность и качество

- Чтение — без модификации Pi-сессий и файлов. Запись — явное подтверждение, проверка границ, backup/rollback и fail-closed; никаких `wsl --unregister`, неконтролируемого `wsl --shutdown` или массовой очистки.
- Публичный GitHub: никогда не публиковать ключи, `auth.json`, `.env`, историю сессий, локальные приватные пути/конфиги, провайдерские идентификаторы и дампы. Без внешнего listener по умолчанию.
- Реализация: связный пакет по Issue, **TDD Red → Green → Refactor**, узкие тесты при разработке и полный релевантный acceptance перед merge; синхронизировать `ROADMAP.md`. Реальный Windows+WSL smoke — отдельный gate. Непроведённое явно `NOT RUN`.
- Независимое ревью обязательно; нельзя self-approve, подменять evidence или merge без согласия владельца. Инфраструктуру не расширять без продуктового блокера.

## Skills — инструкции по требованию

При старте сессии прочитать только нужные Issue/PR и компактный каталог доступных Skills (имена, описания, источники). **Все применимые** Skills, включая установленные вне репозитория, прочитать перед первым использованием; уже прочитанные неизменные файлы не загружать повторно.

- [pi-desktop-status](.pi/skills/pi-desktop-status/SKILL.md) — восстановление состояния GitHub и выбор следующего шага.
- [pi-desktop-development](.pi/skills/pi-desktop-development/SKILL.md) — TDD, архитектура, точечные/полные проверки.
- [pi-desktop-safety](.pi/skills/pi-desktop-safety/SKILL.md) — разрешения, данные Pi, безопасность операций.
- [pi-desktop-review](.pi/skills/pi-desktop-review/SKILL.md) — независимый review и приёмка PR.

Релевантные Skills применяются совместно, а не заменяют друг друга. В отчёте указывать discovered / loaded / applied / unavailable / skipped с причинами.

## Выбор thinking и отчёт

**Политика назначения, не автоматическое переключение:** GitHub/status/детерминированное чтение → `off`; документация/типовой отчёт → `low`; планирование/диагностика → `medium`; **любой код/TDD, архитектура, security и независимый review → `high`**. Выбранный уровень проверять на фактической Pi/модели; если уровень недоступен или effective отличается, раскрыть это, не выдавать за PASS. Ни этот файл, ни Skills сами не меняют настройки. Полная политика: [docs/TOKEN_EFFICIENCY.md](docs/TOKEN_EFFICIENCY.md).

Любой итог PR: Issue, base/head SHA, файлы и `+/-` строк, что сделано/не сделано, команды тестов с PASS/FAIL/SKIP/NOT RUN, Windows+WSL smoke, риски/rollback, применённые Skills, статус ROADMAP, независимый verdict, фактические thinking/cost либо `NOT MEASURED`. **Merge только по прямому разрешению владельца.**
