// Inline SVG icons, drawn from simple primitives so the project carries no icon-font or
// third-party icon licence. All are decorative: pair them with a visible or aria label.
import type { ReactNode } from "react";

interface IconProps {
  readonly className?: string;
  readonly size?: number;
}

function Svg({ children, className, size = 20 }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
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

/** The product mark — the diamond drawn beside the name in 10 §2. */
export function LogoMark({ className, size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path d="M12 2 22 12 12 22 2 12Z" fill="currentColor" />
      <path d="M12 7 17 12 12 17 7 12Z" fill="#093E9B" />
    </svg>
  );
}

export const ChevronDown = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const Dots = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const HelpIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" />
    <circle cx="12" cy="17" r=".6" fill="currentColor" />
  </Svg>
);
export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.44 5.01 L13.44 2.91 L14.71 3.21 L14.68 5.53 L17.25 7.37 L19.44 6.59 L20.13 7.70 L18.47 9.32 L18.99 12.44 L21.09 13.44 L20.79 14.71 L18.47 14.68 L16.63 17.25 L17.41 19.44 L16.30 20.13 L14.68 18.47 L11.56 18.99 L10.56 21.09 L9.29 20.79 L9.32 18.47 L6.75 16.63 L4.56 17.41 L3.87 16.30 L5.53 14.68 L5.01 11.56 L2.91 10.56 L3.21 9.29 L5.53 9.32 L7.37 6.75 L6.59 4.56 L7.70 3.87 L9.32 5.53Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);
export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Svg>
);
export const StarIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8Z"
      fill={filled ? "currentColor" : "none"}
    />
  </Svg>
);
export const PagesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.5h7l4 4V20.5H7Z" />
    <path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6" />
  </Svg>
);
export const RequirementsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="m8 9 1.5 1.5L12 8M8 15l1.5 1.5L12 14M14 9.5h3M14 15.5h3" />
  </Svg>
);
export const ExportOpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 13v6.5h14V13" />
  </Svg>
);
export const PageTreeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="4.5" rx="1" />
    <rect x="13" y="10" width="7" height="4.5" rx="1" />
    <rect x="13" y="16.5" width="7" height="4" rx="1" />
    <path d="M7 8.5V12h6M7 12v6.5h6" />
  </Svg>
);
export const ChevronsLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 6-6 6 6 6M19 6l-6 6 6 6" />
  </Svg>
);
export const ChevronsRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 6 6 6-6 6M5 6l6 6-6 6" />
  </Svg>
);
