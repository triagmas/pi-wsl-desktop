/**
 * M2 Pi Resource Manager UI (Issue #7): Skills / Extensions(Packages) / MCP.
 *
 * Write boundary: every mutating action goes preview → explicit confirm →
 * apply; the plan panel always shows the exact (redacted) command and the
 * files that will be rewritten plus the backup id. Inventory rows render as
 * plain text (hostile names/diagnostics stay inert) and MCP env VALUES never
 * arrive in the first place (keys only, enforced by the bridge contract).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DesktopApi } from './api';
import { parseBridgeError } from './m1api';
import { m2, type PreviewOpInput } from './m2api';
import { IconModules, IconResources, IconSearch, IconTerminal } from './shell/icons';
import type { BuiltinInfoT, McpServerInfoT, PackageInfoT, ResourceOpPlanT, SkillInfoT } from './types';

type ResTab = 'skills' | 'packages' | 'mcp';

interface OpResult {
  ok: boolean;
  opId: string;
  output: string;
  backupId: string | null;
  verified: boolean;
}

export function ResourcesView({ api }: { api: DesktopApi | null }) {
  const [tab, setTab] = useState<ResTab>('skills');
  const [skills, setSkills] = useState<SkillInfoT[] | null>(null);
  const [packages, setPackages] = useState<{ packages: PackageInfoT[]; builtins: BuiltinInfoT[]; settingsExtensions: string[] } | null>(null);
  const [mcp, setMcp] = useState<{ servers: McpServerInfoT[]; builtinEnabled: boolean; logDiagnostics: string[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [plan, setPlan] = useState<ResourceOpPlanT | null>(null);
  const [opResult, setOpResult] = useState<OpResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // R02 A5: reference-style inventory filtering (client-side, over real data).
  const [skillQuery, setSkillQuery] = useState('');
  const [skillSource, setSkillSource] = useState('all');

  // Install/add form state (cleared as soon as a plan is produced — secrets
  // must not linger in the renderer after the preview request).
  const [pkgSource, setPkgSource] = useState('');
  const [mcpName, setMcpName] = useState('');
  const [mcpEndpoint, setMcpEndpoint] = useState('');
  const [mcpEnvKey, setMcpEnvKey] = useState('');
  const [mcpEnvValue, setMcpEnvValue] = useState('');

  const load = useCallback(
    (t: ResTab): Promise<void> => {
      if (!api) return Promise.resolve();
      if (t === 'skills') {
        return m2
          .listSkills(api)
          .then((r) => {
            setSkills(r.skills);
            setDiagnostics(r.diagnostics);
            setError(null);
          })
          .catch((err: unknown) => setError(parseBridgeError(err)));
      }
      if (t === 'packages') {
        return m2
          .listPackages(api)
          .then((r) => {
            setPackages(r);
            setDiagnostics(r.diagnostics);
            setError(null);
          })
          .catch((err: unknown) => setError(parseBridgeError(err)));
      }
      return m2
        .listMcpServers(api)
        .then((r) => {
          setMcp(r);
          setDiagnostics(r.diagnostics);
          setError(null);
        })
        .catch((err: unknown) => setError(parseBridgeError(err)));
    },
    [api],
  );

  useEffect(() => {
    let alive = true;
    const wanted = tab;
    const run = (): Promise<void> => {
      if (wanted === 'skills' && skills !== null) return Promise.resolve();
      if (wanted === 'packages' && packages !== null) return Promise.resolve();
      if (wanted === 'mcp' && mcp !== null) return Promise.resolve();
      return load(wanted);
    };
    void run().then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [tab, skills, packages, mcp, load]);

  const startPreview = (input: PreviewOpInput): void => {
    if (!api) return;
    setNotice(null);
    setError(null);
    setOpResult(null);
    m2
      .preview(api, input)
      .then((r) => setPlan(r.plan))
      .catch((err: unknown) => setError(parseBridgeError(err)));
  };

  const confirmPlan = (): void => {
    if (!plan || !api) return;
    m2
      .apply(api, plan.planId)
      .then((r) => {
        setOpResult(r);
        setPlan(null);
        setNotice(r.ok ? (r.verified ? 'Операция выполнена и подтверждена' : 'Операция выполнена, но проверка не подтвердилась') : 'Операция завершилась ошибкой CLI');
        void load(tab);
      })
      .catch((err: unknown) => setError(parseBridgeError(err)));
  };

  const rollback = (): void => {
    if (!opResult || !api) return;
    m2
      .rollback(api, opResult.opId)
      .then((r) => {
        setNotice(
          r.conflicts && r.conflicts.length > 0
            ? `Откат отменён для ${r.conflicts.length} файл(ов): они изменены вне нашей транзакции (внешним процессом или нашим неудавшимся CLI) — данные сохранены`
            : r.ok
              ? `Откат выполнен: ${r.restored.length} файл(ов) восстановлено`
              : 'Откат не выполнен: восстановить копии не удалось — исходные файлы не изменены',
        );
        setOpResult(null);
        void load(tab);
      })
      .catch((err: unknown) => setError(parseBridgeError(err)));
  };

  const excluded = (s: SkillInfoT): boolean => s.status === 'excluded';

  /** Russian plural for the inventory meta line (1 навык / 2 навыка / 5 навыков). */
  const skillsWord = (n: number): string => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'навык';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'навыка';
    return 'навыков';
  };

  const skillSources = useMemo(
    () => (skills === null ? [] : [...new Set(skills.map((s) => s.source))].sort()),
    [skills],
  );
  const visibleSkills = useMemo(() => {
    if (skills === null) return [];
    const q = skillQuery.trim().toLowerCase();
    return skills.filter(
      (s) =>
        (skillSource === 'all' || s.source === skillSource) &&
        (q === '' ||
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q)),
    );
  }, [skills, skillQuery, skillSource]);

  return (
    <section data-testid="resources-view" className="resources">
      <header className="view-intro">
        <h1>Ресурсы</h1>
        <p className="muted">Навыки, расширения и подключения вашего Pi</p>
      </header>

      <nav className="main-tabs" data-testid="res-tabs">
        {(
          [
            ['skills', 'Skills'],
            ['packages', 'Extensions'],
            ['mcp', 'MCP'],
          ] as Array<[ResTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`res-tab-${key}`}
            className={tab === key ? 'tab tab-active' : 'tab'}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error-box" data-testid="res-error" role="alert">
          <strong>{error.code}</strong> — {error.message}
        </div>
      )}
      {notice && (
        <p className="notice" data-testid="res-notice">
          {notice}
        </p>
      )}

      {plan && (
        <div className="op-plan" data-testid="op-plan">
          <h3>Подтверждение записи</h3>
          <p data-testid="op-description">{plan.description}</p>
          <p>
            <code data-testid="op-command">{plan.command.join(' ')}</code>
            {plan.commandRedacted && (
              <span className="badge" data-testid="op-redacted">
                секреты скрыты
              </span>
            )}
          </p>
          <ul data-testid="op-files">
            {plan.filesTouched.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p data-testid="op-backup">Резервная копия: {plan.backupId ?? 'файл ещё не существовал'}</p>
          <div className="op-actions">
            <button type="button" data-testid="op-confirm" onClick={confirmPlan}>
              Подтвердить запись
            </button>
            <button
              type="button"
              data-testid="op-cancel"
              onClick={() => {
                setPlan(null);
                setNotice('Операция отменена — ничего не записано');
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {opResult && (
        <div className={opResult.ok && opResult.verified ? 'op-result ok' : 'op-result'} data-testid="op-result">
          <p>
            {opResult.ok ? 'OK' : 'FAIL'} · проверка: {opResult.verified ? 'подтверждена' : 'не подтверждена'}
          </p>
          <pre data-testid="op-output">{opResult.output}</pre>
          {opResult.backupId && (
            <button type="button" data-testid="op-rollback" onClick={rollback}>
              Откатить операцию
            </button>
          )}
        </div>
      )}

      {tab === 'skills' && (
        <div className="res-panel" data-testid="panel-skills">
          <div className="res-toolbar">
            <label className="res-search">
              <IconSearch className="res-search-icon" />
              <input
                data-testid="skills-search"
                type="search"
                placeholder="Найти навык..."
                aria-label="Найти навык"
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
              />
            </label>
            <label className="res-source-filter">
              <span className="visually-hidden">Источник</span>
              <select
                data-testid="skills-source-filter"
                aria-label="Источник"
                value={skillSource}
                onChange={(e) => setSkillSource(e.target.value)}
              >
                <option value="all">Все источники</option>
                {skillSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {skills === null ? (
            <p className="muted">Загрузка…</p>
          ) : (
            <>
              <p className="res-meta muted" data-testid="skills-meta">
                {visibleSkills.length} {skillsWord(visibleSkills.length)}
              </p>
              <ul className="res-skill-list" data-testid="skills-list">
                {visibleSkills.length === 0 && <li className="muted sidebar-empty">Навыки не найдены</li>}
                {visibleSkills.map((s) => (
                  <li key={`${s.source}:${s.dir}`} data-testid="skill-row" className="res-skill-row">
                    <span className="res-row-tile" aria-hidden="true">
                      <IconResources />
                    </span>
                    <span className="res-row-main">
                      <span className="res-row-name">{s.name}</span>
                      <span className="res-row-desc muted">{s.description ?? 'Описание не указано'}</span>
                    </span>
                    <span className="res-row-source muted" data-testid="skill-source">
                      {s.source}
                    </span>
                    {s.status !== 'ok' && (
                      <span className="badge badge-warn" data-testid="skill-status">
                        {s.status}
                      </span>
                    )}
                    <button
                      type="button"
                      data-testid="skill-toggle"
                      className="res-row-action"
                      disabled={s.status === 'missing' || s.status === 'invalid'}
                      onClick={() =>
                        startPreview({
                          kind: 'skill-set',
                          source: s.dir,
                          disable: !excluded(s),
                        })
                      }
                    >
                      {excluded(s) ? 'Включить' : 'Отключить'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'packages' && (
        <div className="res-panel" data-testid="panel-packages">
          <div className="res-tile-head" aria-hidden="true">
            <IconModules />
          </div>
          <form
            className="res-form"
            data-testid="install-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (pkgSource.trim().length === 0) return;
              startPreview({ kind: 'package-install', source: pkgSource.trim() });
              setPkgSource('');
            }}
          >
            <input
              data-testid="install-source"
              placeholder="npm:пакет / git:github.com/… / ./local"
              value={pkgSource}
              onChange={(e) => setPkgSource(e.target.value)}
              aria-label="Источник пакета"
            />
            <button type="submit" data-testid="install-submit">
              Установить…
            </button>
          </form>
          {packages === null ? (
            <p className="muted">Загрузка…</p>
          ) : (
            <>
              <table className="res-table" data-testid="packages-table">
                <thead>
                  <tr>
                    <th>Источник</th>
                    <th>Scope</th>
                    <th>Наличие</th>
                    <th>Путь</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.packages.map((p) => (
                    <tr key={`${p.scope}:${p.source}`} data-testid="pkg-row">
                      <td>{p.source}</td>
                      <td>{p.scope}</td>
                      <td data-testid="pkg-present">{p.present ? 'установлен' : 'отсутствует'}</td>
                      <td>{p.path ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          data-testid="pkg-remove"
                          onClick={() => startPreview({ kind: 'package-remove', source: p.source, local: p.scope === 'project' })}
                        >
                          Удалить…
                        </button>{' '}
                        <button
                          type="button"
                          data-testid="pkg-update"
                          onClick={() => startPreview({ kind: 'package-update', source: p.source, local: p.scope === 'project' })}
                        >
                          Обновить…
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4>Встроенные расширения</h4>
              <ul data-testid="builtins-list">
                {packages.builtins.map((b) => (
                  <li key={b.name}>
                    {b.name} — {b.enabled ? 'включено' : 'выключено'}
                  </li>
                ))}
              </ul>
              {packages.settingsExtensions.length > 0 && (
                <p className="muted" data-testid="settings-extensions">
                  Записи extensions: {packages.settingsExtensions.join(', ')}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'mcp' && (
        <div className="res-panel" data-testid="panel-mcp">
          <div className="res-tile-head" aria-hidden="true">
            <IconTerminal />
          </div>
          <form
            className="res-form"
            data-testid="mcp-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (mcpName.trim().length === 0 || mcpEndpoint.trim().length === 0) return;
              const isUrl = mcpEndpoint.startsWith('http');
              const hasEnv = mcpEnvKey.trim().length > 0 && !isUrl; // --env is stdio-only (bridge rejects it with --url)
              startPreview({
                kind: 'mcp-add',
                source: mcpName.trim(),
                ...(isUrl ? { url: mcpEndpoint.trim() } : { command: mcpEndpoint.trim().split(/\s+/) }),
                ...(hasEnv ? { env: { [mcpEnvKey.trim()]: mcpEnvValue } } : {}),
              });
              setMcpName('');
              setMcpEndpoint('');
              setMcpEnvKey('');
              setMcpEnvValue('');
            }}
          >
            <input data-testid="mcp-name" placeholder="имя сервера" value={mcpName} onChange={(e) => setMcpName(e.target.value)} aria-label="Имя сервера" />
            <input
              data-testid="mcp-endpoint"
              placeholder="https://… или команда с аргументами"
              value={mcpEndpoint}
              onChange={(e) => setMcpEndpoint(e.target.value)}
              aria-label="URL или команда"
            />
            <input data-testid="mcp-env-key" placeholder="ENV_KEY (не значение)" value={mcpEnvKey} onChange={(e) => setMcpEnvKey(e.target.value)} aria-label="Имя переменной окружения" />
            <input
              data-testid="mcp-env-value"
              type="password"
              placeholder="значение (не отображается)"
              value={mcpEnvValue}
              onChange={(e) => setMcpEnvValue(e.target.value)}
              aria-label="Значение переменной"
            />
            <button type="submit" data-testid="mcp-add-submit">
              Добавить…
            </button>
          </form>
          {mcp === null ? (
            <p className="muted">Загрузка…</p>
          ) : (
            <>
              <p data-testid="mcp-builtin">Встроенный MCP: {mcp.builtinEnabled ? 'включён' : 'выключен'}</p>
              <table className="res-table" data-testid="mcp-table">
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Scope</th>
                    <th>Транспорт</th>
                    <th>Команда/URL</th>
                    <th>ENV</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {mcp.servers.map((s) => (
                    <tr key={`${s.scope}:${s.name}`} data-testid="mcp-row">
                      <td>
                        {s.name}
                        {s.hasProjectOverride && <span className="badge">project override</span>}
                        {s.oauthConfigured && <span className="badge">oauth</span>}
                        {!s.enabled && (
                          <span className="badge" data-testid="mcp-disabled">
                            выключен
                          </span>
                        )}
                      </td>
                      <td>{s.scope}</td>
                      <td>{s.transport}</td>
                      <td>{s.command ?? '—'}</td>
                      <td data-testid="mcp-envkeys">{s.envKeys.length > 0 ? s.envKeys.join(', ') : '—'}</td>
                      <td>
                        <button
                          type="button"
                          data-testid="mcp-remove"
                          onClick={() => startPreview({ kind: 'mcp-remove', source: s.name, local: s.scope === 'project' })}
                        >
                          Удалить…
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mcp.logDiagnostics.length > 0 && (
                <p className="muted" data-testid="mcp-log">
                  Журнал (только уровни): {mcp.logDiagnostics.join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {diagnostics.length > 0 && (
        <ul className="diagnostics" data-testid="res-diagnostics">
          {diagnostics.slice(0, 10).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
