/**
 * App Shell (Issue #21 §9.1 item 2): independently managed LeftSidebar /
 * CenterWorkspace / RightSidebar / StatusBar around the center column. The
 * shell owns layout only — data and contracts stay in feature components
 * mounted in the slots, so re-placing a detail never changes its data path.
 */
import { type ReactNode } from 'react';

export interface AppShellProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode | null;
  status: ReactNode;
}

export function AppShell({ left, center, right, status }: AppShellProps) {
  return (
    <div data-testid="app-shell" className="shell">
      <div className="shell-body">
        {left}
        <div data-testid="center-workspace" className="center-workspace">
          {center}
        </div>
        {right}
      </div>
      {status}
    </div>
  );
}
