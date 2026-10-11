"use client";

// A small modal dialog (WAI-ARIA dialog pattern): role=dialog, aria-modal, named by its title
// and described by its body; focus moves in on open (to `data-autofocus`, else the first
// control), Tab and Shift+Tab stay inside, Escape and a press on the backdrop dismiss it, and
// focus returns to where it was when the dialog closes — or, when that control is gone (a menu
// item that opened the dialog), to `fallbackFocus` (the editor).
// spec: docs/specs/10-ui-reference.md section 5.1 (Revert to last published asks first; the link dialog)
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { t } from "@/copy";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly title: string;
  /** Body text that describes the dialog (aria-describedby). */
  readonly description?: string;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
  /** `wide` for tables and grids (the keyboard shortcuts, the macro browser). */
  readonly size?: "normal" | "wide";
  /** Where focus goes on close when the control that had it before is gone. */
  readonly fallbackFocus?: () => void;
}

const SIZE_CLASS = { normal: "max-w-md", wide: "max-w-2xl" } as const;

export function Dialog({ title, description, onDismiss, children, testId, size = "normal", fallbackFocus }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dismissRef = useRef(onDismiss);
  const fallbackRef = useRef(fallbackFocus);

  useEffect(() => {
    dismissRef.current = onDismiss;
    fallbackRef.current = fallbackFocus;
  });

  useEffect(() => {
    const active = document.activeElement;
    const previous = active instanceof HTMLElement && active !== document.body ? active : null;
    const dialog = ref.current;
    const target = dialog?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else fallbackRef.current?.();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) dismissRef.current();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onPointerDown={onBackdropPointerDown}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-testid={testId}
        onKeyDown={onKeyDown}
        className={`max-h-[85vh] w-full overflow-y-auto ${SIZE_CLASS[size]} rounded bg-white p-5 text-slate-900 shadow-xl`}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-2 text-sm text-slate-700">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export const primaryButtonClass =
  "inline-flex h-8 items-center rounded bg-action-primary px-3 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex h-8 items-center rounded px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

export interface ConfirmDialogProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  /** Defaults to `Cancel`. */
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testId?: string;
}

/** A question with two answers. The safe answer (cancel) has the focus. */
export function ConfirmDialog({ title, description, confirmLabel, cancelLabel, onConfirm, onCancel, testId }: ConfirmDialogProps) {
  return (
    <Dialog title={title} description={description} onDismiss={onCancel} testId={testId}>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel} data-autofocus="">
          {cancelLabel ?? t("editor.cancel")}
        </button>
        <button type="button" className={primaryButtonClass} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
