"use client";

// The pieces both toolbar rows are built from: a button (named from the copy deck, aria-pressed
// when it toggles, aria-disabled rather than disabled so it stays in the roving order), a group
// separator, and an inert placeholder for a control a later pass wires up.
// spec: docs/specs/10-ui-reference.md section 5.1 (toolbar rows 1 and 2); RD-057
import type { ReactNode } from "react";
import { t } from "@/copy";
import { ROVING_ITEM_ATTRIBUTE } from "./roving";

export const toolbarButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded px-1 text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-pressed:bg-slate-200 aria-pressed:text-action-primary";

export interface ToolbarButtonProps {
  /** Accessible name (and tooltip), from the copy deck. */
  readonly label: string;
  readonly onPress: () => void;
  /** Set for toggles: rendered as aria-pressed. */
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly children: ReactNode;
}

/**
 * A toolbar command. A pointer press does not take focus from the editor, so the selection the
 * command applies to stays visible; keyboard users reach it through the toolbar's roving focus.
 */
export function ToolbarButton({ label, onPress, pressed, disabled = false, testId, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      {...{ [ROVING_ITEM_ATTRIBUTE]: "" }}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      className={toolbarButtonClass}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}

/** The `│` between groups. */
export function ToolbarSeparator() {
  return <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;
}

/**
 * A control whose behaviour arrives in a later pass (uploads, the `+` menu, find, help): drawn
 * and named so the layout is final, inert until then (as RD-052 draws `later` elements).
 */
export function ToolbarSlot({ label, testId, children }: { readonly label: string; readonly testId?: string; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      {...{ [ROVING_ITEM_ATTRIBUTE]: "" }}
      aria-label={label}
      aria-disabled="true"
      title={t("shell.later")}
      data-testid={testId}
      className={toolbarButtonClass}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </button>
  );
}
