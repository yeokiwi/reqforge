// The page tree's glyphs, which src/ui/icons.tsx lacks: the closed-parent chevron `›`, the leaf
// bullet `•` (10 §3.2 draws both), the "+" of "create a child page" and the alert's close cross.
// Decorative: every control that shows one has an accessible name from the copy deck.
import type { ReactNode } from "react";

interface IconProps {
  readonly className?: string;
  readonly size?: number;
}

function Svg({ children, className, size = 14 }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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

/** `›` a page with children, closed. */
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

/** `▾` a page with children, open. */
export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

/** `•` a page without children. */
export const BulletIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
  </Svg>
);

/** `+` create a page. */
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

/** `×` dismiss. */
export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
