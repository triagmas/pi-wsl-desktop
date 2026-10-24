/**
 * App Shell (Issue #21 §9.1 item 2 / R02 A1+A6): slim branded title bar
 * (drag region; native Windows caption buttons render on top via overlay),
 * then LeftSidebar / CenterWorkspace / RightSidebar around the center column
 * and the fixed 28px StatusBar flush at the bottom. The shell owns layout
 * only — data and contracts stay in feature components mounted in the slots.
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
      <div className="shell-topbar" data-testid="shell-topbar">
        <span className="brand-mark" data-testid="brand-mark" aria-hidden="true">
          π
        </span>
        <span className="app-wordmark">Pi WSL Desktop</span>
      </div>
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
