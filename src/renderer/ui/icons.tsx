/**
 * Design Lab — line-иконки (Issue #21, D1). Чисто presentational: stroke =
 * currentColor, размер задаётся CSS-классами контекста. Формы повторяют
 * эталонные мокапы (folder / речевой пузырь / database / puzzle / gear и т.д.).
 */
import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

function svg(path: ReactNode, { size = 20, strokeWidth = 1.6 }: IconProps = {}, viewBox = 24): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} 24`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

export const IconPlus = (p: IconProps = {}) => svg(<path d="M12 5v14M5 12h14" />, p);

export const IconSearch = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>,
    p,
  );

export const IconFolder = (p: IconProps = {}) =>
  svg(
    <path d="M3.5 7.2c0-1 .8-1.8 1.8-1.8h4l2 2.4h7.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V7.2z" />,
    p,
  );

export const IconChevronDown = (p: IconProps = {}) => svg(<path d="M6 9.5l6 6 6-6" />, p);

export const IconChevronRight = (p: IconProps = {}) => svg(<path d="M9.5 6l6 6-6 6" />, p);

export const IconChevronLeft = (p: IconProps = {}) => svg(<path d="M14.5 6l-6 6 6 6" />, p);

export const IconChatBubble = (p: IconProps = {}) =>
  svg(
    <path d="M4 12.2c0-3.8 3.4-6.7 8-6.7s8 2.9 8 6.7-3.4 6.7-8 6.7c-.9 0-1.7-.1-2.5-.3L5.5 20l1-3.2C4.9 15.5 4 14 4 12.2z" />,
    p,
  );

export const IconDatabase = (p: IconProps = {}) =>
  svg(
    <>
      <ellipse cx="12" cy="6.5" rx="7" ry="3" />
      <path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>,
    p,
  );

export const IconPuzzle = (p: IconProps = {}) =>
  svg(
    <path d="M9.5 4.5a2.5 2.5 0 0 1 5 0V6h3.2c.7 0 1.3.6 1.3 1.3v3.2h1.5a2.5 2.5 0 0 1 0 5H19v3.2c0 .7-.6 1.3-1.3 1.3H14.5v-1.5a2.5 2.5 0 0 0-5 0v1.5H6.3c-.7 0-1.3-.6-1.3-1.3V15H3.5a2.5 2.5 0 0 1 0-5H5V7.3c0-.7.6-1.3 1.3-1.3h3.2V4.5z" />,
    p,
  );

export const IconGear = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5l1.4 2.3 2.7-.4.6 2.6 2.5 1.1-1.1 2.5 1.1 2.5-2.5 1.1-.6 2.6-2.7-.4L12 20.5l-1.4-2.3-2.7.4-.6-2.6-2.5-1.1 1.1-2.5-1.1-2.5 2.5-1.1.6-2.6 2.7.4L12 3.5z" />
    </>,
    { strokeWidth: 1.4, ...p },
  );

export const IconFileDoc = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M6.5 4.5h7l4 4v11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" />
      <path d="M13.5 4.5v4h4" />
    </>,
    p,
  );

export const IconCheck = (p: IconProps = {}) => svg(<path d="M5.5 12.5l4.2 4.2L18.5 8" />, p);

export const IconCheckCircle = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="M7.2 12.4l3.3 3.3 6.3-6.6" stroke="var(--pw-body-text-color)" strokeWidth="2.2" />
    </>,
    p,
  );

export const IconCopy = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>,
    p,
  );

export const IconRefresh = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </>,
    p,
  );

export const IconDots = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>,
    p,
  );

/** «|>» — кнопка сворачивания/разворачивания панели (эталон ref1/ref5). */
export const IconPanelExpand = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M6 4.5v15" strokeWidth="2.6" />
      <path d="M11.5 6.5l6 5.5-6 5.5" strokeWidth="2.4" />
    </>,
    p,
  );

export const IconArrowUp = (p: IconProps = {}) => svg(<path d="M12 19V5.5M5.5 12L12 5.5 18.5 12" strokeWidth="2" />, p);

export const IconInfo = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const IconPaperclip = (p: IconProps = {}) =>
  svg(<path d="M16.8 7.6l-6.4 6.4a2.4 2.4 0 0 0 3.4 3.4l7-7a4.4 4.4 0 0 0-6.2-6.2l-7.2 7.2a6.4 6.4 0 0 0 9 9l5.4-5.4" />, p);

export const IconTerminalGlyph = (p: IconProps = {}) => svg(<path d="M5 7l5 5-5 5M12.5 17.5H19" strokeWidth="2" />, p);

export const IconExpandArrows = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-6 6M4.5 19.5l6-6" />
    </>,
    p,
  );

export const IconClose = (p: IconProps = {}) => svg(<path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" />, p);

export const IconMinimize = (p: IconProps = {}) => svg(<path d="M5 12h14" strokeWidth="1.4" />, p);

export const IconMaximize = (p: IconProps = {}) => svg(<rect x="5.7" y="5.7" width="12.6" height="12.6" rx="1" strokeWidth="1.4" />, p);

export const IconBulb = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.6.5 1 1.2 1 2v.5h4.4v-.5c0-.8.4-1.5 1-2A5.5 5.5 0 0 0 12 3.5z" />
      <path d="M10 19.5h4M10.7 21.5h2.6" />
    </>,
    p,
  );

export const IconCode = (p: IconProps = {}) => svg(<path d="M9 8l-4.5 4L9 16M15 8l4.5 4L15 16" strokeWidth="1.8" />, p);

export const IconBookDoc = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="4.5" y="4" width="15" height="16" rx="2" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </>,
    p,
  );

export const IconMonitor = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="3.5" y="5" width="17" height="11.5" rx="1.8" />
      <path d="M9.5 20h5M12 16.5V20" />
    </>,
    p,
  );

export const IconShield = (p: IconProps = {}) => svg(<path d="M12 3.5l7 2.5v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6l7-2.5z" />, p);

export const IconCpu = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 3.5v3.5M14 3.5v3.5M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" />
    </>,
    p,
  );

/** Память (статус-бар RAM): шина с зубцами — эталон 05-terminal-under-chat. */
export const IconMemory = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="3.5" y="8" width="17" height="8" rx="1.5" />
      <path d="M7 8V5.5M12 8V5.5M17 8V5.5M7 16v2.5M12 16v2.5M17 16v2.5" />
    </>,
    p,
  );
