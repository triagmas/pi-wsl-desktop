/**
 * Terminal dock SLOT (Issue #21 §9.6 step 2 / exec task §7): UI-A reserves
 * the layout space strictly under the composer and above the global status
 * bar, in the center column only — and renders NO fake terminal. The real
 * WSL PTY, tabs and controls belong to UI-B; nothing here executes or
 * imitates commands.
 */
export interface TerminalSlotProps {
  /** Reserved height in px (persisted layout hint for the future dock). */
  height: number;
}

export function TerminalSlot({ height }: TerminalSlotProps) {
  return (
    <div
      data-testid="terminal-slot"
      className="terminal-slot"
      style={{ minHeight: `${Math.round(height / 4)}px` }}
      aria-hidden="true"
    />
  );
}
