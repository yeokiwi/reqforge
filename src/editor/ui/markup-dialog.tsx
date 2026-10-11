"use client";

// The `+ ▾` menu's `Markup` (10 §5.5: "paste Markdown or HTML and convert"): a text area and a
// Markdown/HTML choice. Markdown is converted with `marked`, then both go through the paste
// sanitiser and the schema's own parser (insertMarkup), so what lands is exactly what a paste of
// the same HTML would give: remote images are left out (RD-058), refused links keep their text,
// scripts and styles go. Markup that yields nothing says so instead of inserting nothing.
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup); docs/specs/09-decision-log.md sections RD-058, RD-063, RD-068
import { type FormEvent, useId, useState } from "react";
import { t } from "@/copy";
import { Dialog, primaryButtonClass, secondaryButtonClass } from "./dialog";
import type { MarkupFormat } from "./markdown";

export interface MarkupDialogProps {
  /** Inserts the markup; false when nothing in it can go on the page. */
  readonly onSubmit: (source: string, format: MarkupFormat) => boolean;
  readonly onCancel: () => void;
  readonly fallbackFocus?: () => void;
}

const FORMATS: readonly MarkupFormat[] = ["markdown", "html"];

// spec: docs/specs/10-ui-reference.md section 5.5 (Markup — paste Markdown or HTML and convert)
export function MarkupDialog({ onSubmit, onCancel, fallbackFocus }: MarkupDialogProps) {
  const [format, setFormat] = useState<MarkupFormat>("markdown");
  const [source, setSource] = useState("");
  const [empty, setEmpty] = useState(false);
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const groupName = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmit(source, format)) setEmpty(true);
  };

  return (
    <Dialog title={t("editor.markup.title")} onDismiss={onCancel} testId="markup-dialog" size="wide" fallbackFocus={fallbackFocus}>
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium">{t("editor.markup.format")}</legend>
          <div className="mt-1 flex gap-4">
            {FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={groupName}
                  value={f}
                  checked={format === f}
                  onChange={() => {
                    setFormat(f);
                    setEmpty(false);
                  }}
                />
                {t(f === "markdown" ? "editor.markup.markdown" : "editor.markup.html")}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t("editor.markup.input")}
          </label>
          <textarea
            id={inputId}
            rows={12}
            value={source}
            spellCheck={false}
            data-autofocus=""
            aria-invalid={empty || undefined}
            aria-describedby={empty ? `${errorId} ${helpId}` : helpId}
            className={`mt-1 block w-full rounded border px-2 py-1.5 font-mono text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary ${empty ? "border-red-600" : "border-slate-300"}`}
            onChange={(event) => {
              setSource(event.target.value);
              if (empty) setEmpty(false);
            }}
          />
          {empty ? (
            <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
              {t("editor.markup.empty")}
            </p>
          ) : null}
          <p id={helpId} className="mt-1 text-xs text-slate-500">
            {t("editor.markup.help")}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            {t("editor.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass}>
            {t("editor.dialog.insert")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
