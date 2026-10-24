/**
 * M3 Modules view — the core-owned management surface for the registry: it
 * lists every registered entry with an honest state and reason, and toggles
 * enable/disable for valid modules, including dependency-blocked ones.
 * Blocked modules can be explicitly disabled to prevent surprise reactivation
 * when a provider returns. Invalid/incompatible entries have no toggle.
 */
import type { ModuleEntry } from './modules/registry';

export interface ModulesViewProps {
  entries: readonly ModuleEntry[];
  /** R04: bounded discovery/persistence diagnostics (rendered only when non-empty). */
  diagnostics?: readonly string[];
  /** Review #6: initial discovery in flight — toggles are disabled (data-loading). */
  loading?: boolean;
  /** Review #6: modules whose persistence write is in flight — their toggle is locked. */
  busyIds?: ReadonlySet<string>;
  /** Toggle handler: (moduleId, nextEnabled). */
  onToggle: (moduleId: string, enabled: boolean) => void;
}

const NO_BUSY: ReadonlySet<string> = new Set();

export function ModulesView({
  entries,
  diagnostics,
  loading = false,
  busyIds = NO_BUSY,
  onToggle,
}: ModulesViewProps) {
  return (
    <section className="panel" aria-label="Модули" data-testid="modules-view" data-loading={loading ? 'true' : 'false'}>
      {/* R03 п.3: no stacked «Модули» duplicate — the window-titlebar path
          carries the section title. */}
      {entries.length === 0 ? (
        <p data-testid="modules-empty">Модули не зарегистрированы.</p>
      ) : (
        <ul className="module-list">
          {entries.map((entry) => {
            const toggleable = entry.state === 'enabled' || entry.state === 'disabled' || entry.state === 'blocked';
            return (
              <li key={entry.key} className="module-entry" data-testid={`module-entry-${entry.key}`}>
                <div className="module-entry-main">
                  <strong data-testid={`module-id-${entry.key}`}>{entry.id}</strong>
                  <span
                    className={`badge badge-${entry.state}`}
                    data-testid={`module-row-state-${entry.key}`}
                  >
                    {entry.state}
                  </span>
                  {entry.manifest && (
                    <span className="module-entry-version">v{entry.manifest.version}</span>
                  )}
                </div>
                {toggleable ? (
                  <button
                    type="button"
                    data-testid={`module-toggle-${entry.id}`}
                    aria-pressed={entry.state !== 'disabled'}
                    disabled={loading || busyIds.has(entry.id)}
                    aria-busy={loading || busyIds.has(entry.id)}
                    onClick={() => onToggle(entry.id, entry.state === 'disabled')}
                  >
                    {entry.state === 'disabled' ? 'Включить' : 'Отключить'}
                  </button>
                ) : (
                  <span className="module-entry-fixed" data-testid={`module-fixed-${entry.key}`}>
                    недоступен
                  </span>
                )}
                {entry.errors.length > 0 && (
                  <p
                    className="request-error"
                    role="alert"
                    data-testid={`module-errors-${entry.key}`}
                  >
                    {entry.errors.join(' · ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {diagnostics !== undefined && diagnostics.length > 0 && (
        <ul className="module-list" data-testid="modules-diagnostics">
          {diagnostics.map((line, index) => (
            <li key={`${index}-${line.slice(0, 24)}`} data-testid={`module-diagnostic-${index}`}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
