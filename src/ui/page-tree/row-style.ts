// How a row of the page tree looks, as pure functions of its state. Colours are the 10 §1.1
// tokens; nothing here depends on colour alone — the current page is bold (10 §3.2), the
// highlighted one has a ring, a drop target an outline or a line, a focused row a focus ring.
// spec: docs/specs/10-ui-reference.md sections 1.1 (colour roles) and 3.2 (current page in bold)
import type { DropZone } from "./model";

export type PageTreeVariant = "sidebar" | "overview";

export interface RowState {
  readonly variant: PageTreeVariant;
  readonly highlighted: boolean;
  readonly drop: DropZone | null;
}

/** Left padding of a row at `level` (1 for a root), in pixels. */
export function rowIndent(variant: PageTreeVariant, level: number): number {
  const step = variant === "sidebar" ? 14 : 22;
  return Math.max(0, level - 1) * step;
}

/** The row: the chevron, the title link and the "+" (not the children). Called once per row render. */
export function rowClassName(state: RowState): string {
  const base =
    state.variant === "sidebar"
      ? "relative flex min-h-7 items-center gap-1 rounded pr-1 text-sm hover:bg-surface-sidebar-selected/60"
      : "relative flex min-h-9 items-center gap-2 rounded pr-2 text-base hover:bg-slate-50";
  const highlight = state.highlighted ? " bg-amber-50 ring-2 ring-inset ring-amber-400" : "";
  const inside = state.drop === "inside" ? " outline outline-2 -outline-offset-2 outline-action-primary bg-action-primary/10" : "";
  return `${base}${highlight}${inside}`;
}

/** The title link. The current page is bold (10 §3.2). */
export function titleClassName(variant: PageTreeVariant, current: boolean): string {
  const weight = current ? " font-bold" : "";
  return variant === "sidebar"
    ? `min-w-0 flex-1 truncate py-1 text-slate-800 no-underline hover:underline${weight}`
    : `min-w-0 flex-1 break-words py-1.5 text-link no-underline hover:underline${weight}`;
}

/** The line drawn for a drop before or after a row. */
export function dropLineClassName(zone: "before" | "after"): string {
  return `pointer-events-none absolute left-0 right-0 h-0.5 rounded bg-action-primary ${zone === "before" ? "-top-px" : "-bottom-px"}`;
}
