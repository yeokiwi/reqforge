// Small glyphs for the compare screen's status badges, beside the status word (colour is never
// the only signal). Decorative: always paired with visible text.
// spec: docs/specs/09-decision-log.md section RD-060 (added, removed, changed)
import type { ReactNode } from "react";

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const AddedGlyph = () => (
  <Glyph>
    <path d="M5 1.5v7M1.5 5h7" />
  </Glyph>
);

export const RemovedGlyph = () => (
  <Glyph>
    <path d="M1.5 5h7" />
  </Glyph>
);

export const ChangedGlyph = () => (
  <Glyph>
    <path d="M1.5 3.5h7M1.5 6.5h7" />
  </Glyph>
);
