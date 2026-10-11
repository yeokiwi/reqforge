// The editor toolbar's glyphs (10 section 5.1, read as RD-057 reads them), drawn from simple
// SVG primitives like src/ui/icons.tsx so the project carries no icon font. All decorative:
// every control that shows one has an accessible name from the copy deck.
import type { ReactNode } from "react";

interface IconProps {
  readonly className?: string;
  readonly size?: number;
}

function Svg({ children, className, size = 18, strokeWidth = 1.8 }: IconProps & { children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="1.3" fill="currentColor" stroke="none" />;

export const BoldIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M7 5h5.5a3.25 3.25 0 0 1 0 6.5H7zM7 11.5h6.5a3.25 3.25 0 0 1 0 6.5H7z" />
  </Svg>
);
export const ItalicIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 5h8M6 19h8M14.5 5l-5 14" />
  </Svg>
);
export const UnderlineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />
  </Svg>
);
/** `A▾`: an A over a bar in the current colour. */
export const TextColourIcon = ({ colour, ...p }: IconProps & { colour?: string | null }) => (
  <Svg {...p}>
    <path d="M6.5 15 12 3.5 17.5 15M8.5 11h7" />
    <rect x="4" y="18" width="16" height="3" rx="0.5" fill={colour ?? "currentColor"} stroke="none" />
  </Svg>
);
/** `Aᵃ▾`: an A with a small a. */
export const MoreFormattingIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 18 8 5l5 13M5 14h6" />
    <circle cx="17.5" cy="15.5" r="2.5" />
    <path d="M20 13v5" />
  </Svg>
);
export const BulletListIcon = (p: IconProps) => (
  <Svg {...p}>
    {dot(5, 6)}
    {dot(5, 12)}
    {dot(5, 18)}
    <path d="M9 6h11M9 12h11M9 18h11" />
  </Svg>
);
export const OrderedListIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.6}>
    <path d="M4 4.5 5.5 4v4.5M4 8.5h3M4 13.5c.4-1.2 2.8-1.2 2.8.3 0 1.1-2.8 1.6-2.8 2.7h3" />
    <path d="M10 6h10M10 12h10M10 18h10" />
  </Svg>
);
export const TaskListIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="5" rx="1" />
    <path d="m4.3 6.6 1 1 1.7-1.9" />
    <rect x="3" y="14" width="5" height="5" rx="1" />
    <path d="M11 6.5h9M11 16.5h9" />
  </Svg>
);
export const OutdentIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16M11 10h9M11 14h9M4 19h16M7.5 9.5 4.5 12l3 2.5" />
  </Svg>
);
export const IndentIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16M11 10h9M11 14h9M4 19h16M4.5 9.5l3 2.5-3 2.5" />
  </Svg>
);
export const AlignLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
  </Svg>
);
export const AlignRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />
  </Svg>
);
export const AlignCentreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
  </Svg>
);
/** `▭`: the info panel, a plain rectangle outline (RD-057). */
export const InfoPanelIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
  </Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5-5 3.5 3.5L15 14l5 4.5" />
  </Svg>
);
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
export const TableIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" />
  </Svg>
);
export const EmojiIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    {dot(9, 10)}
    {dot(15, 10)}
    <path d="M8.5 14.5a4.2 4.2 0 0 0 7 0" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6 4 10l4 4" />
    <path d="M4.5 10H14a5.5 5.5 0 0 1 0 11h-3" />
  </Svg>
);
export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m16 6 4 4-4 4" />
    <path d="M19.5 10H10a5.5 5.5 0 0 0 0 11h3" />
  </Svg>
);
export const LabelIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7Z" />
    <circle cx="8" cy="9" r="1.3" />
  </Svg>
);
/** The restriction padlock: open, or closed when the page is restricted (10 section 4.1). */
export const LockIcon = ({ closed = false, ...p }: IconProps & { closed?: boolean }) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9.5" rx="1.5" />
    <path d={closed ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.6-1.7"} />
  </Svg>
);
const tableFrame = <path d="M3.5 4.5h17v15h-17zM3.5 12h17M12 4.5v15" />;
export const RowAboveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 11h17v9h-17zM12 11v9" />
    <path d="M12 2.5v6M9 5.5h6" />
  </Svg>
);
export const RowBelowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4h17v9h-17zM12 4v9" />
    <path d="M12 15.5v6M9 18.5h6" />
  </Svg>
);
export const DeleteRowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5h17v7h-17z" />
    <path d="m9.5 3 5 3M14.5 3l-5 3" />
    <path d="m9.5 18 5 3M14.5 18l-5 3" />
  </Svg>
);
export const ColumnBeforeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3.5h9v17h-9zM11 12h9" />
    <path d="M2.5 12h6M5.5 9v6" />
  </Svg>
);
export const ColumnAfterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 3.5h9v17H4zM4 12h9" />
    <path d="M15.5 12h6M18.5 9v6" />
  </Svg>
);
export const DeleteColumnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 3.5h7v17h-7z" />
    <path d="m2.5 9.5 3 5M5.5 9.5l-3 5M18.5 9.5l3 5M21.5 9.5l-3 5" />
  </Svg>
);
export const MergeCellsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4.5h17v15h-17z" />
    <path d="M6.5 12h4M8.5 10l2 2-2 2M17.5 12h-4M15.5 10l-2 2 2 2" />
  </Svg>
);
export const SplitCellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4.5h17v15h-17zM12 4.5v15" />
    <path d="M10 12H6.5M8.5 10l-2 2 2 2M14 12h3.5M15.5 10l2 2-2 2" />
  </Svg>
);
export const HeaderRowIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="5" fill="currentColor" stroke="none" opacity="0.45" />
    {tableFrame}
  </Svg>
);
export const HeaderColumnIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="5.5" height="15" fill="currentColor" stroke="none" opacity="0.45" />
    {tableFrame}
  </Svg>
);
export const NumberedColumnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 4.5h11v15h-11zM9.5 12h11" />
    <path d="M4 5.5 5.5 5v4.5M3.5 13.5c.4-1.2 2.8-1.2 2.8.3 0 1.1-2.8 1.6-2.8 2.7h3" strokeWidth="1.4" />
  </Svg>
);
/** `fill ▾`: a paint bucket over a bar in the current fill. */
export const FillIcon = ({ colour, ...p }: IconProps & { colour?: string | null }) => (
  <Svg {...p}>
    <path d="m11 3 7 7-6 6-7-7Z" />
    <path d="M18.5 12.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8Z" />
    <rect x="4" y="18.5" width="16" height="3" rx="0.5" fill={colour ?? "none"} stroke="currentColor" strokeWidth="1" />
  </Svg>
);
export const DeleteTableIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4.5h12v11h-12zM3.5 10h12M9.5 4.5v11" />
    <path d="m15.5 15.5 5 5M20.5 15.5l-5 5" />
  </Svg>
);
export const TableWidthIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3" />
  </Svg>
);
/** Find and replace: previous match. */
export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
/** Find and replace: next match. */
export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
/** Close a bar. */
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
