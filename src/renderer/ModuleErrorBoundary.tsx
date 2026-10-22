/**
 * M3 render-error isolation — one boundary per module contribution. A module
 * that throws while rendering must degrade to a visible error card with a
 * working escape (disable the module), never take the app down
 * (SPECIFICATION.md §5, ROADMAP M3 «изоляция ошибок»).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ModuleErrorBoundaryProps {
  /** Module id shown in the fallback card and its testid. */
  moduleId: string;
  /** Offered as the escape hatch in the fallback card. */
  onDisable?: () => void;
  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  error: Error | null;
}

export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console honest for diagnostics; the UI already degraded.
    console.error(`module "${this.props.moduleId}" failed to render`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    const { moduleId, onDisable, children } = this.props;
    if (error) {
      return (
        <div className="error-box module-error" role="alert" data-testid={`module-error-${moduleId}`}>
          <div>
            <strong>Модуль «{moduleId}»: ошибка отрисовки</strong>
            <span> — {error.message}</span>
          </div>
          {onDisable && (
            <button type="button" onClick={onDisable}>
              Отключить модуль
            </button>
          )}
        </div>
      );
    }
    return children;
  }
}
