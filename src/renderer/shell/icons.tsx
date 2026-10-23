/**
 * One coherent icon family for the whole shell (UI-A R02 A1/A2): inline
 * stroke SVG on `currentColor`, 16px grid, rounded caps — matching the
 * approved mockups. Replaces every ad-hoc emoji/Unicode glyph in navigation.
 * Icons are decorative (aria-hidden); accessible names live on the buttons.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  };
}

/** Sidebar collapse/expand rails: `[<` / `>]`. */
export function IconRailCollapse(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M6 5.5 8.5 8 6 10.5" />
    </svg>
  );
}

export function IconRailExpand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M10 5.5 7.5 8 10 10.5" />
    </svg>
  );
}

/** Details panel toggle (right sidebar). */
export function IconDetailsPanel(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M9.5 5.5 12 8 9.5 10.5" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M1.8 4.2A1.2 1.2 0 0 1 3 3h3l1.4 1.6H13A1.2 1.2 0 0 1 14.2 5.8v6A1.2 1.2 0 0 1 13 13H3a1.2 1.2 0 0 1-1.2-1.2z" />
    </svg>
  );
}

export function IconChatBubble(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 8.4c0 2.6-2.5 4.7-5.5 4.7-.7 0-1.4-.1-2-.3L3 13.6l.9-2.3A4.4 4.4 0 0 1 2.5 8.4c0-2.6 2.5-4.7 5.5-4.7s5.5 2.1 5.5 4.7Z" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function IconResources(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="8" cy="3.8" rx="5.2" ry="2" />
      <path d="M2.8 3.8v8.4c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V3.8" />
      <path d="M2.8 8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2" />
    </svg>
  );
}

export function IconModules(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.4 2.2h3.2v1.6a1.2 1.2 0 1 0 2.4 0V2.2h1.6v3.2h-1.6a1.2 1.2 0 1 0 0 2.4h1.6v6H2.2v-6h1.6a1.2 1.2 0 1 0 0-2.4H2.2V2.2h3.2v1.6a1.2 1.2 0 1 0 2.4 0z" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </svg>
  );
}

export function IconDots(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="3.4" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.6" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3 4.5 3 3-3 3M8 11.5h5" />
    </svg>
  );
}
