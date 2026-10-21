/**
 * M3 Modules view — the core-owned management surface for the registry: it
 * lists every registered entry with an honest state and reason, and toggles
 * enable/disable for valid modules. Invalid/incompatible entries are shown
 * with their errors and deliberately have no toggle (they cannot be
 * promoted — see registry.setModuleEnabled).
 */
import type { ModuleEntry } from './modules/registry';

export interface ModulesViewProps {
  entries: readonly ModuleEntry[];
  /** Toggle handler: (moduleId, nextEnabled). */
  onToggle: (moduleId: string, enabled: boolean) => void;
}

export function ModulesView({ entries, onToggle }: ModulesViewProps) {
  return (
    <section className="panel" aria-label="Модули">
      <header className="panel-header">
        <h2 data-testid="modules-heading">Модули</h2>
      </header>
      {entries.length === 0 ? (
        <p data-testid="modules-empty">Модули не зарегистрированы.</p>
      ) : (
        <ul className="module-list">
          {entries.map((entry) => {
            const toggleable = entry.state === 'enabled' || entry.state === 'disabled';
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
                    aria-pressed={entry.state === 'enabled'}
                    onClick={() => onToggle(entry.id, entry.state !== 'enabled')}
                  >
                    {entry.state === 'enabled' ? 'Отключить' : 'Включить'}
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
    </section>
  );
}
