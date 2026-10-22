/**
 * M3 R03 — module panel surface.
 *
 * A panel is a module contribution exactly like a tab: it renders through the
 * ONE shared block contract (`ModuleBlocks`) and sits behind its own
 * `ModuleErrorBoundary`, so a panel render error degrades to a visible card
 * with the owner's escape hatch instead of taking the surface down
 * (SPECIFICATION §5, PRODUCT §3.4, plan R03 Task 3).
 */
import { ModuleErrorBoundary } from './ModuleErrorBoundary';
import { ModuleBlocks } from './ModuleTabView';
import type { ModuleAction } from '../shared/m3Protocol';
import type { ModuleTab } from './modules/registry';

export interface ModulePanelProps {
  /** Panel projection from `modulePanels()`. */
  panel: ModuleTab;
  /** Boundary escape hatch — disable the owning module. */
  onDisable?: () => void;
  /**
   * Declarative actions for this surface. The caller passes them only for a
   * module that owns no tab, so every action has exactly one reachable button.
   */
  actions?: readonly ModuleAction[];
  onAction?: (action: ModuleAction) => void;
}

export function ModulePanel({ panel, onDisable, actions, onAction }: ModulePanelProps) {
  const { entry, tab } = panel;
  return (
    <ModuleErrorBoundary moduleId={entry.id} onDisable={onDisable}>
      <aside className="module-panel" data-testid={`module-panel-${panel.tabKey}`}>
        <h3 className="module-panel-title">{tab.title}</h3>
        <ModuleBlocks blocks={tab.blocks} />
        {actions && actions.length > 0 && (
          <div className="module-actions" role="group" aria-label="Действия модуля">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`module-action-${entry.id}/${action.id}`}
                onClick={() => onAction?.(action)}
              >
                {action.title}
              </button>
            ))}
          </div>
        )}
      </aside>
    </ModuleErrorBoundary>
  );
}
