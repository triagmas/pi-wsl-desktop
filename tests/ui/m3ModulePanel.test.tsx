/**
 * M3 R03 fix (review F1): a panel is a module contribution like a tab, so it
 * must sit behind its OWN ModuleErrorBoundary — one keyed boundary per panel,
 * with the owner's escape hatch. Without it a panel render error would take
 * the whole surface down (plan R03, Task 3).
 *
 * The block vocabulary is total, so a throwing panel child is injected here by
 * constructing the projection directly — the same technique the existing
 * ModuleErrorBoundary tests use. This pins the isolation contract, not a claim
 * that a valid JSON manifest can crash today.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ModulePanel } from '../../src/renderer/ModulePanel';
import type { ModuleTab } from '../../src/renderer/modules/registry';

function Bomb(): ReactNode {
  throw new Error('взрыв панели');
}

function panelProjection(overrides: Partial<ModuleTab> = {}): ModuleTab {
  return {
    tabKey: 'boom/rail',
    entry: {
      key: 'module-0',
      id: 'boom',
      state: 'enabled',
      manifest: null,
      errors: [],
    },
    tab: {
      kind: 'panel',
      id: 'rail',
      title: 'Rail',
      blocks: [{ type: 'text', value: 'здоровый контент панели' }],
    },
    ...overrides,
  };
}

describe('ModulePanel — isolated render error boundary', () => {
  it('renders the panel blocks behind a boundary with a working escape', async () => {
    const onDisable = vi.fn();
    render(<ModulePanel panel={panelProjection()} onDisable={onDisable} />);

    expect(screen.getByTestId('module-panel-boom/rail')).toBeInTheDocument();
    expect(screen.queryByTestId('module-error-boom')).not.toBeInTheDocument();
  });

  it('isolates a throwing panel behind its boundary and offers disable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onDisable = vi.fn();
    const throwing = panelProjection({
      tab: {
        kind: 'panel',
        id: 'rail',
        title: 'Rail',
        // non-JSON injection: the projection is built directly in this test
        blocks: [{ type: 'text', value: <Bomb /> } as never],
      },
    });

    render(<ModulePanel panel={throwing} onDisable={onDisable} />);

    expect(screen.getByTestId('module-error-boom')).toBeInTheDocument();
    expect(screen.queryByTestId('module-panel-boom/rail')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Отключить модуль' }));
    // the escape hatch fires; App binds the owning module id when wiring it
    expect(onDisable).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
