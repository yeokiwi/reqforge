// The page view's glyphs (10 section 4: 🔓 📎 ✎ ◉ ⇪), drawn from simple primitives like
// src/ui/icons.tsx, which lacks them. All are decorative: pair them with a visible or aria label.
import type { ReactNode } from "react";

interface IconProps {
  readonly className?: string;
  readonly size?: number;
}

function Svg({ children, className, size = 18 }: IconProps & { readonly children: ReactNode }) {
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

/** 🔓 / 🔒: the restrictions padlock; open unless the page is restricted (10 section 4.1). */
export const PadlockIcon = ({ closed = false, ...p }: IconProps & { readonly closed?: boolean }) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="1.5" />
    <path d={closed ? "M8 11V7.5a4 4 0 0 1 8 0V11" : "M8 11V7.5a4 4 0 0 1 7.6-1.7"} />
  </Svg>
);

/** 📎 attachments. */
export const PaperclipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  </Svg>
);

/** ✎ Edit. */
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);

/** ◉ Watching: a filled centre while watching, hollow otherwise — shape, not only colour. */
export const WatchIcon = ({ on = false, ...p }: IconProps & { readonly on?: boolean }) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" fill={on ? "currentColor" : "none"} />
  </Svg>
);

/** × dismiss. */
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

/** ⇪ Share. */
export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 12v7.5h14V12" />
  </Svg>
);
