"use client";

// The editors of the two inline values the `+ ▾` menu inserts (10 §5.5): Date and Status. Each
// checks its value with the schema's own rule before it is accepted (RD-068: a real date; status
// text 1–60 characters on one line), so the document never holds what the server refuses.
// spec: docs/specs/10-ui-reference.md section 5.5 (Date, Status); docs/specs/09-decision-log.md section RD-068
import { type FormEvent, useId, useState } from "react";
import { type ParamlessCopyId, t } from "@/copy";
import { CLASS, STATUS_COLOURS, type StatusColour, isCalendarDate, isStatusText } from "@/editor/schema";
import { normaliseStatusText } from "@/editor/schema/nodes";
import { Dialog, primaryButtonClass, secondaryButtonClass } from "./dialog";
import { stripUnstorable } from "./paste";

const inputClass =
  "mt-1 block w-full rounded border px-2 py-1.5 text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary";

// ------------------------------------------------------------------------------------ date

export interface DateDialogProps {
  /** `YYYY-MM-DD` to start from. */
  readonly value: string;
  /** Editing an existing date (`Edit date` / `Done`) rather than inserting one. */
  readonly editing: boolean;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
  readonly fallbackFocus?: () => void;
}

// spec: docs/specs/10-ui-reference.md section 5.5 (Date); RD-068 (a real date)
export function DateDialog({ value, editing, onSubmit, onCancel, fallbackFocus }: DateDialogProps) {
  const [date, setDate] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const errorId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCalendarDate(date)) {
      setInvalid(true);
      return;
    }
    onSubmit(date);
  };

  return (
    <Dialog title={t(editing ? "editor.date.editTitle" : "editor.date.title")} onDismiss={onCancel} testId="date-dialog" fallbackFocus={fallbackFocus}>
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t("editor.insert.date")}
          </label>
          <input
            id={inputId}
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            value={date}
            data-autofocus=""
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className={`${inputClass} ${invalid ? "border-red-600" : "border-slate-300"}`}
            onChange={(event) => {
              setDate(event.target.value);
              if (invalid) setInvalid(false);
            }}
          />
          {invalid ? (
            <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
              {t("editor.date.invalid")}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            {t("editor.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass}>
            {t(editing ? "editor.dialog.done" : "editor.dialog.insert")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- status

/** The name of each lozenge colour, from the fixed palette's copy (RD-069 seeds the colours). */
export const STATUS_COLOUR_COPY: Readonly<Record<StatusColour, ParamlessCopyId>> = Object.freeze({
  grey: "editor.colour.grey",
  red: "editor.colour.red",
  yellow: "editor.colour.yellow",
  green: "editor.colour.green",
  blue: "editor.colour.blue",
  purple: "editor.colour.purple",
});

/** The status text as it will be stored, or null when the schema refuses it (RD-068). */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (status text: 1–60 characters, one line); RD-068
export function checkStatusText(raw: string): string | null {
  const text = normaliseStatusText(stripUnstorable(raw));
  return isStatusText(text) ? text : null;
}

export interface StatusDialogProps {
  readonly text: string;
  readonly colour: StatusColour;
  readonly onSubmit: (input: { readonly text: string; readonly colour: StatusColour }) => void;
  readonly onCancel: () => void;
  readonly fallbackFocus?: () => void;
}

// spec: docs/specs/10-ui-reference.md section 5.5 (Status — lozenge); 1.2 (lozenge)
export function StatusDialog({ text, colour, onSubmit, onCancel, fallbackFocus }: StatusDialogProps) {
  const [value, setValue] = useState(text);
  const [chosen, setChosen] = useState<StatusColour>(colour);
  const [invalid, setInvalid] = useState(false);
  const textId = useId();
  const errorId = useId();
  const groupName = useId();
  const preview = checkStatusText(value);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = checkStatusText(value);
    if (checked === null) {
      setInvalid(true);
      return;
    }
    onSubmit({ text: checked, colour: chosen });
  };

  return (
    <Dialog title={t("editor.status.title")} onDismiss={onCancel} testId="status-dialog" fallbackFocus={fallbackFocus}>
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label htmlFor={textId} className="block text-sm font-medium">
            {t("editor.status.text")}
          </label>
          <input
            id={textId}
            type="text"
            autoComplete="off"
            value={value}
            data-autofocus=""
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className={`${inputClass} ${invalid ? "border-red-600" : "border-slate-300"}`}
            onChange={(event) => {
              setValue(event.target.value);
              if (invalid) setInvalid(false);
            }}
          />
          {invalid ? (
            <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
              {t("editor.status.invalid")}
            </p>
          ) : null}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">{t("editor.status.colour")}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {STATUS_COLOURS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="radio" name={groupName} value={c} checked={chosen === c} onChange={() => setChosen(c)} />
                <span aria-hidden="true" className="rf-content inline-block">
                  <span className={CLASS.status(c)}>{t(STATUS_COLOUR_COPY[c])}</span>
                </span>
                <span className="sr-only">{t(STATUS_COLOUR_COPY[c])}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {preview ? (
          <p aria-hidden="true" className="rf-content">
            <span className={CLASS.status(chosen)}>{preview}</span>
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            {t("editor.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass}>
            {t("editor.dialog.done")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
