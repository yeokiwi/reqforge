"use client";

// `···` → Delete (10 section 4.1, RD-059). Deleting is soft and takes the whole subtree, and the
// confirmation names how many pages will go (RD-056). That number is read afresh from the server
// (GET …/pages/{id}: descendantCount) as the dialog opens — never taken from the page view's
// render, which a move in the sidebar or another user's new child page may have outdated — and
// Delete stays unavailable until it has arrived; if it cannot be read, nothing can be deleted.
// It is ConfirmDialog's layout — the question, Cancel (focused: the safe answer) and Delete — on
// the shared Dialog, because the confirmation must also show a refusal and stay busy while the
// request runs, which ConfirmDialog cannot. On success the page no longer exists, so the space
// overview replaces it in the browser history (Back would only reach a 404).
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md sections RD-056, RD-059
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import type { FetchLike } from "@/ui/api-client";
import { Dialog } from "@/ui/dialog";
import { spaceHref } from "@/ui/page-view/urls";
import { countFailureMessage, deleteConfirmation, deleteFailureMessage } from "../_lib/dialog-messages";
import { fetchDescendantCount, requestDelete } from "../_lib/page-requests";
import { DialogAlert, DialogFooter, DialogStatus, dialogPrimaryClass, dialogSecondaryClass } from "./dialog-parts";

export interface DeletePageDialogProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  readonly onClose: () => void;
  readonly fetchImpl?: FetchLike;
}

/** How many pages the delete would take, as far as the dialog knows. */
type Count =
  | { readonly state: "counting" }
  | { readonly state: "counted"; readonly sentence: string }
  | { readonly state: "failed"; readonly message: string };

// spec: docs/specs/09-decision-log.md section RD-056 (deleting is soft and takes the subtree; the confirmation names how many pages will go)
export function DeletePageDialog({ space, page, onClose, fetchImpl }: DeletePageDialogProps) {
  const router = useRouter();
  const [count, setCount] = useState<Count>({ state: "counting" });
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let live = true;
    fetchDescendantCount(space.key, page.id, fetchImpl).then(
      (descendants) => {
        if (live) setCount({ state: "counted", sentence: deleteConfirmation(descendants) });
      },
      (error: unknown) => {
        if (live) setCount({ state: "failed", message: countFailureMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [space.key, page.id, fetchImpl]);

  const ready = count.state === "counted";

  const dismiss = () => {
    if (!busyRef.current) onClose();
  };

  const confirm = async () => {
    if (busyRef.current || !ready) return;
    busyRef.current = true;
    setBusy(true);
    setAlert(null);
    try {
      await requestDelete(space.key, page.id, fetchImpl);
      // Stays busy: the space overview replaces this screen. Refresh second, so Next runs it on
      // the overview after the navigation (the layout's tree and the router cache drop the page).
      router.replace(spaceHref(space.key));
      router.refresh();
    } catch (error) {
      setAlert(deleteFailureMessage(error));
      busyRef.current = false;
      setBusy(false);
    }
  };

  // The description is read when the dialog opens, while the count may still be on its way; the
  // polite status then announces the sentence when it arrives, and the progress while deleting.
  const description = count.state === "counted" ? count.sentence : count.state === "counting" ? t("pageDelete.counting") : undefined;
  const status = busy ? t("pageDelete.busy") : count.state === "counted" ? count.sentence : "";

  return (
    <Dialog title={t("pageDelete.title", { title: page.title })} description={description} onDismiss={dismiss} testId="delete-page-dialog">
      <DialogAlert message={count.state === "failed" ? count.message : alert} />
      <DialogStatus message={status} />
      <DialogFooter>
        <button type="button" className={dialogSecondaryClass} aria-disabled={busy || undefined} onClick={dismiss} data-autofocus="">
          {t("pageView.dialog.cancel")}
        </button>
        <button
          type="button"
          className={dialogPrimaryClass}
          aria-disabled={busy || !ready || undefined}
          aria-busy={busy || undefined}
          onClick={() => void confirm()}
        >
          {t("pageDelete.confirm")}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
