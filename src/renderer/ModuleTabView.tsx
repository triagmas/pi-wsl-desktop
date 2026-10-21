/**
 * M3 generic module tab renderer — ONE contract for every registered module.
 * App maps `moduleTabs()` output onto this component; adding a module never
 * patches the core (PRODUCT.md §3.4). The block switch is intentionally a
 * tiny closed vocabulary with a visible default arm: an unknown block type
 * degrades to a warning, it does not throw.
 */
import { ModuleErrorBoundary } from './ModuleErrorBoundary';
import type { ModuleBlock } from '../shared/m3Protocol';
import type { ModuleTab } from './modules/registry';

export interface ModuleTabViewProps {
  tab: ModuleTab;
  /** Escape hatch wired to the registry (disable this module). */
  onDisable: (moduleId: string) => void;
}

function renderBlock(block: ModuleBlock, index: number) {
  switch (block.type) {
    case 'text':
      return (
        <p key={index} className="module-block-text">
          {block.value}
        </p>
      );
    case 'kv':
      return (
        <dl key={index} className="module-block-kv">
          {block.entries.map((entry) => (
            <div key={entry.key}>
              <dt>{entry.key}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'list':
      return (
        <ul key={index} className="module-block-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    default: {
      const unknown = block as { type?: unknown };
      return (
        <p key={index} className="request-error" data-testid="module-block-unsupported">
          Неподдерживаемый блок: {String(unknown.type)}
        </p>
      );
    }
  }
}

export function ModuleTabView({ tab, onDisable }: ModuleTabViewProps) {
  const { entry } = tab;
  const moduleId = entry.id;
  return (
    <ModuleErrorBoundary moduleId={moduleId} onDisable={() => onDisable(moduleId)}>
      <section className="panel module-panel" data-testid={`module-tab-${moduleId}`}>
        <header className="panel-header">
          <h2>{tab.tab.title}</h2>
          <span className="badge" data-testid={`module-state-${moduleId}`}>
            {entry.state}
          </span>
        </header>
        {tab.tab.blocks.map((block, index) => renderBlock(block, index))}
      </section>
    </ModuleErrorBoundary>
  );
}
