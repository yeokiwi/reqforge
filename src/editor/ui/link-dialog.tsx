"use client";

// The `🔗` link dialog: an address and optional text. The address is checked with the schema's
// own link rule (isAllowedHref, RD-063 and RD-068), so the dialog can never put a link in the
// document that the server would refuse on the next autosave.
// spec: docs/specs/10-ui-reference.md section 5.1 (`🔗`); docs/specs/03-authoring-and-indexing.md section 1.4 (link.href); RD-057, RD-063, RD-068
import { type FormEvent, useId, useState } from "react";
import { t } from "@/copy";
import { isAllowedHref } from "@/editor/schema";
import { Dialog, primaryButtonClass, secondaryButtonClass } from "./dialog";

/** The address as it will be stored, or null when the schema's link rule refuses it. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (link.href: http, https, mailto, tel, or a same-site path); RD-063, RD-068
export function validateLinkHref(raw: string): string | null {
  const href = raw.trim();
  return isAllowedHref(href) ? href : null;
}

export interface LinkDialogProps {
  /** The address of the link being edited, or null when inserting one. */
  readonly href: string | null;
  readonly onSubmit: (input: { readonly href: string; readonly text: string }) => void;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}

const inputClass =
  "mt-1 block w-full rounded border px-2 py-1.5 text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary";

/** The secondary button, in red: removing the link is the destructive choice. */
const removeButtonClass = secondaryButtonClass.replace("text-slate-700", "text-red-700");

export function LinkDialog({ href, onSubmit, onRemove, onCancel }: LinkDialogProps) {
  const editing = href !== null;
  const [address, setAddress] = useState(href ?? "");
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const urlId = useId();
  const urlHelpId = useId();
  const errorId = useId();
  const textId = useId();
  const textHelpId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = validateLinkHref(address);
    if (checked === null) {
      setInvalid(true);
      return;
    }
    onSubmit({ href: checked, text });
  };

  return (
    <Dialog title={t(editing ? "editor.linkDialog.editTitle" : "editor.linkDialog.title")} onDismiss={onCancel} testId="link-dialog">
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label htmlFor={urlId} className="block text-sm font-medium">
            {t("editor.linkDialog.url")}
          </label>
          <input
            id={urlId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={address}
            data-autofocus=""
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${errorId} ${urlHelpId}` : urlHelpId}
            className={`${inputClass} ${invalid ? "border-red-600" : "border-slate-300"}`}
            onChange={(event) => {
              setAddress(event.target.value);
              if (invalid) setInvalid(false);
            }}
          />
          {invalid ? (
            <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
              {t("editor.linkDialog.invalid")}
            </p>
          ) : null}
          <p id={urlHelpId} className="mt-1 text-xs text-slate-500">
            {t("editor.linkDialog.urlHelp")}
          </p>
        </div>
        <div>
          <label htmlFor={textId} className="block text-sm font-medium">
            {t("editor.linkDialog.text")}
          </label>
          <input
            id={textId}
            type="text"
            autoComplete="off"
            value={text}
            aria-describedby={textHelpId}
            className={`${inputClass} border-slate-300`}
            onChange={(event) => setText(event.target.value)}
          />
          <p id={textHelpId} className="mt-1 text-xs text-slate-500">
            {t("editor.linkDialog.textHelp")}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {editing ? (
            <button type="button" className={removeButtonClass} onClick={onRemove}>
              {t("editor.linkDialog.remove")}
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            {t("editor.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass}>
            {t(editing ? "editor.linkDialog.save" : "editor.linkDialog.submit")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
