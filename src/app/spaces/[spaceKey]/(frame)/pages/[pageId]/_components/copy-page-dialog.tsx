"use client";

// `···` → Copy (10 section 4.1, RD-059). Copy duplicates ONE page, never its descendants, as
// `Copy of <title>` made unique (RD-056); it goes last among the page's siblings and carries the
// images the page shows (RD-074). The dialog says so, offers that title in an editable field,
// checks it as the server will (RD-067) before sending, and on success opens the copy.
//
// While the request is in flight the dialog cannot be dismissed and a second Copy sends nothing:
// the copy is made under the space's tree lock and a second press would make a second copy.
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md sections RD-056, RD-059, RD-067, RD-074
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "@/copy";
import type { PageDetail, PageSummary } from "@/domain/documents/api-types";
import { checkTitle } from "@/domain/documents/title";
import type { FetchLike } from "@/ui/api-client";
import { Dialog } from "@/ui/dialog";
import { pageHref } from "@/ui/page-view/urls";
import { suggestCopyTitle } from "../_lib/copy-suggestion";
import { copyFailure, titleProblemMessage } from "../_lib/dialog-messages";
import { requestCopy } from "../_lib/page-requests";
import { DialogAlert, DialogFooter, DialogStatus, dialogPrimaryClass, dialogSecondaryClass } from "./dialog-parts";

export interface CopyPageDialogProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  /** The space's live pages: their titles are the ones the suggestion skips. */
  readonly pages: readonly PageSummary[];
  readonly onClose: () => void;
  readonly fetchImpl?: FetchLike;
}

// spec: docs/specs/09-decision-log.md sections RD-056 (Copy duplicates one page as `Copy of <title>`, made unique), RD-067, RD-074
export function CopyPageDialog({ space, page, pages, onClose, fetchImpl }: CopyPageDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState(() => suggestCopyTitle(page.title, pages));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = useId();

  // The Dialog has focused the field by now (child effects run first); select the suggestion so
  // typing replaces it.
  useEffect(() => {
    input.current?.select();
  }, []);

  const dismiss = () => {
    if (!busyRef.current) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    const checked = checkTitle(title);
    if (!checked.ok) {
      setAlert(null);
      setFieldError(titleProblemMessage(checked.problem));
      input.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFieldError(null);
    setAlert(null);
    try {
      const id = await requestCopy(space.key, page.id, checked.title, fetchImpl);
      if (id !== null) {
        // Stays busy: the copy's page view replaces this screen. The refresh comes second on
        // purpose: Next queues it behind the navigation and runs it on the copy's URL, so the
        // layout's data (the top bar, the tree) is re-read too; issued first, the navigation
        // would discard it.
        router.push(pageHref(space.key, id));
        router.refresh();
      } else {
        busyRef.current = false;
        onClose();
        router.refresh();
      }
    } catch (error) {
      const failure = copyFailure(error);
      if (failure.where === "field") {
        setFieldError(failure.message);
        input.current?.focus();
      } else {
        setAlert(failure.message);
      }
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("pageCopy.title", { title: page.title })} description={t("pageCopy.body")} onDismiss={dismiss} testId="copy-page-dialog">
      <form className="mt-4" noValidate onSubmit={(event) => void submit(event)}>
        <label htmlFor={fieldId} className="block text-sm font-medium text-slate-800">
          {t("pageCopy.field")}
        </label>
        <input
          ref={input}
          id={fieldId}
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setFieldError(null);
          }}
          readOnly={busy}
          aria-invalid={fieldError !== null || undefined}
          aria-describedby={fieldError !== null ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm text-slate-900 focus:border-action-primary aria-[invalid=true]:border-red-600"
        />
        {fieldError !== null ? (
          <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
            {fieldError}
          </p>
        ) : null}
        <DialogAlert message={alert} />
        <DialogStatus message={busy ? t("pageCopy.busy") : ""} />
        <DialogFooter>
          <button type="button" className={dialogSecondaryClass} aria-disabled={busy || undefined} onClick={dismiss}>
            {t("pageView.dialog.cancel")}
          </button>
          <button type="submit" className={dialogPrimaryClass} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            {t("pageCopy.submit")}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
