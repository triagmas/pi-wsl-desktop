---
name: pi-desktop-safety
description: Apply trust, privacy, data-integrity and consent gates for Pi WSL Desktop Lite. Use for session/RPC/path operations, resource writes, MCP/extensions, security changes, rollbacks and public GitHub reporting.
---

# Pi Desktop — безопасность и границы записи

**Перед опасной операцией:** установи точный объект, реальную среду, область данных, право на изменение, способ проверки и rollback. Если разрешения нет — останови запись, выполни только допустимое чтение и честно сообщи `BLOCKED` или `NOT RUN`.

- Реальные `~/.pi/agent/`, модели, settings, сессии, истории, MCP credentials и user packages не изменять без отдельного согласия. Не запускать prompts/model calls, внешние MCP соединения, установки и платные provider API как скрытый smoke.
- `wsl --unregister`, безусловный `wsl --shutdown`, неограниченные retries, массовые удаления/миграции запрещены. Пиннинг canonical path, symlink/TOCTOU защита, ownership процесса и безопасная отмена обязательны там, где затрагивается система пользователя.
- Session read не должен менять содержимое, mtime или семантику. Данные пользователя не копируются на Windows. При CLI/GUI гонке — fail-closed и никакой потери данных.
- Любая запись в ресурс Pi: `preview → explicit confirm → apply → verify`, backup перед применением, обратимость/rollback и обработка конфликтов. Нельзя выдавать best effort rollback за доказанный byte-exact.
- Для MCP показывать только необходимые metadata: секреты/env values не передавать через UI/Issue/PR/log. Не устанавливать открытый HTTP-listener. Недоверенные project resources не исполнять.
- GitHub PUBLIC: не публиковать ключи, `auth.json`, `.env`, user session JSONL, внутренние model/provider IDs, реальные метрики сессий/локальные приватные данные. Synthetic fixtures только.
- CI: стандартные GitHub-hosted Linux/Windows runners, read-only token для PR; никаких privileged secrets, опасных workflow triggers или self-hosted PR выполнения.

Сделай негативные тесты для malformed/truncated/oversize, symlink escape, races, cancel/crash/recovery, competing writers, secret leaks и rollback по необходимости. Релевантное security review проводи независимо, target thinking `high`. Не сокращай safety gates ради экономии.