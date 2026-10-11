"use client";

// Small pieces the `···` menu's dialogs share, so they look and behave alike: the button row, the
// failure line, and the polite status line that says what is in progress or what just happened.
// Buttons use aria-disabled rather than disabled while a request is in flight, so the focused
// button keeps the focus (a disabled button drops it to <body>, outside the dialog's focus trap;
// RD-078 uses the same convention).
// spec: docs/specs/10-ui-reference.md section 4.1 (the `···` menu's dialogs); docs/specs/09-decision-log.md section RD-078
import type { ReactNode } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/ui/dialog";

const inert = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** The dialog's main action (Copy, Move, Delete, Hide). */
export const dialogPrimaryClass = `${primaryButtonClass} ${inert}`;
/** Cancel, Close and the dialog's lesser actions. */
export const dialogSecondaryClass = `${secondaryButtonClass} ${inert}`;

export function DialogFooter({ children }: { readonly children: ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>;
}

/** A failure, announced as it appears. */
export function DialogAlert({ message, testId }: { readonly message: string | null; readonly testId?: string }) {
  if (message === null) return null;
  return (
    <p role="alert" className="mt-3 text-sm text-red-700" data-testid={testId}>
      {message}
    </p>
  );
}

/**
 * Progress and outcomes, announced politely. Always rendered (empty when there is nothing to
 * say), so screen readers already know the region when text appears in it.
 */
export function DialogStatus({ message, visible = false, testId }: { readonly message: string; readonly visible?: boolean; readonly testId?: string }) {
  return (
    <p role="status" aria-live="polite" className={visible && message !== "" ? "mt-3 text-sm text-slate-700" : "sr-only"} data-testid={testId}>
      {message}
    </p>
  );
}
