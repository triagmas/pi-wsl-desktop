---
name: pi-desktop-status
description: Recover the current Pi WSL Desktop Lite project state from GitHub, PRs, issues, HEAD, CI and ROADMAP; use at the start of a session or when asked for progress, blockers or next task.
---

# Pi Desktop — статус и восстановление контекста

1. Уточни репозиторий: `triagmas/pi-wsl-desktop`, не VoiceForge. Читай реальные `main`, активный Issue/PR, их base/head SHA, review, CI и комментарии, затем `ROADMAP.md` на релевантной ветке. Не принимай устаревший main ROADMAP или текст PR за более свежее GitHub-состояние.
2. Если есть локальный доступ — **только** `F:\\_hermes\\CODE\\pi-wsl-desktop` / `/mnt/f/_hermes/CODE/pi-wsl-desktop`; сначала `git status --short` и `git log -1 --oneline`, затем проверка upstream. Не переключай ветку при грязном дереве без отдельного решения.
3. Сверь принятые этапы (merged + owner approval), действующий Draft, открытые риски, последних проверенный HEAD и новые commits после него. Для нового HEAD не наследуй прежний CI/review как доказательство.
4. Выбери **одну ближайшую продуктовую задачу** из Issue с критериями приёмки. Не создавай ещё один dashboard, инфраструктуру или десятки маленьких Issue без необходимости.
5. Вывод компактно: `main SHA | work branch/HEAD | Issue/PR | completed | unverified | blocker | next action`. Все тесты, недоступные без реальной машины, маркируй `NOT RUN`.

Для чисто детерминированных GitHub reads запрашивай thinking `off`; если нужен анализ противоречий, переключай задачу в `medium`. См. [политику](../../../docs/TOKEN_EFFICIENCY.md). AGENTS/Skill не могут сами поменять активный thinking.

При переходе к реализации загрузи `pi-desktop-development`; при затрагивании доверия, путей, Pi settings или MCP также `pi-desktop-safety`.