---
name: pi-desktop-development
description: Develop or modify Pi WSL Desktop Lite code via bounded GitHub issue scope, Red-Green-Refactor TDD, targeted then full tests, Windows+WSL smoke and evidence-driven PR updates. Use for implementation and code fixes.
---

# Pi Desktop — разработка

1. Сначала `AGENTS.md`, нужные части `PRODUCT.md`/`SPECIFICATION.md`, Issue/PR, ветка/HEAD и соответствующий код. Используй CodeGraph, если он доступен и ускоряет поиск; не копируй целиком репозиторий/логи/историю в LLM-контекст.
2. Работай только в каноническом checkout на F: и **не в main**. Один связный PR на макропакет; не создавай вторую реализацию Pi, Windows-хранилище его сессий или неавторизованный сторонний JS в Electron. Исполнение Pi/Skills/MCP остаётся в WSL через документированный CLI/RPC/SDK.
3. Для каждого изменения кода: минимальный воспроизводимый RED-тест/контракт **до** исправления → минимальный GREEN → Refactor → целевые негативные сценарии. Проверять реальные версии Pi и CLI parity там, где это важно; симуляция не заменяет живой smoke.
4. Учитывай Zod-контракт Bridge, timeouts/reconnect/cancel, конкуренцию CLI/GUI, read-only без изменения sha256/mtime, conflict/rollback, невалидные вводы и недоверенные пути. Записи в реальные `~/.pi`, платные prompt или внешние MCP без отдельного разрешения запрещены.
5. Локально на узком цикле — нужный Vitest test. Перед приёмкой: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e`, стандартный Linux/Windows CI; реальный Windows 11 + Ubuntu WSL2 + Pi smoke отдельно. Указывай точные PASS/FAIL/SKIP, невозможное — `NOT RUN`. Не подменяй реальные проверки фиктивными тестами.
6. Обнови `ROADMAP.md` с фактическим состоянием, PR с base/head SHA, полным `+/-`, рисками, откатом, списком Skills и измеренным usage/стоимостью (`NOT MEASURED` иначе). Для review обязательно загрузи `pi-desktop-review`.

**Thinking для любого source-code/TDD — target `high`**, не снижай его ради токенов. Для простого анализа без изменения кода — `medium`; для документации — `low`. Используй все остальные релевантные уже установленные Skills, в том числе TDD/debugging/verification; этот Skill не отменяет их. Merge без owner approval запрещён.