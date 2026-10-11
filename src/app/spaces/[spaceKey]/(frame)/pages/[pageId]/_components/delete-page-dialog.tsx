"use client";

// `···` → Delete (10 section 4.1, RD-059). Deleting is soft and takes the whole subtree, and the
// confirmation names how many pages will go: the page plus PageDetail.descendantCount (RD-056).
// It is ConfirmDialog's layout — the question, Cancel (focused: the safe answer) and Delete — on
// the shared Dialog, because the confirmation must also show a refusal and stay busy while the
// request runs, which ConfirmDialog cannot. On success the page no longer exists, so the space
// overview replaces it in the browser history (Back would only reach a 404).
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md sections RD-056, RD-059
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import type { FetchLike } from "@/ui/api-client";
import { Dialog } from "@/ui/dialog";
import { spaceHref } from "@/ui/page-view/urls";
import { deleteConfirmation, deleteFailureMessage } from "../_lib/dialog-messages";
import { requestDelete } from "../_lib/page-requests";
import { DialogAlert, DialogFooter, DialogStatus, dialogPrimaryClass, dialogSecondaryClass } from "./dialog-parts";

export interface DeletePageDialogProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  readonly onClose: () => void;
  readonly fetchImpl?: FetchLike;
}

// spec: docs/specs/09-decision-log.md section RD-056 (deleting is soft and takes the subtree; the confirmation names how many pages will go)
export function DeletePageDialog({ space, page, onClose, fetchImpl }: DeletePageDialogProps) {
  const router = useRouter();
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const dismiss = () => {
    if (!busyRef.current) onClose();
  };

  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setAlert(null);
    try {
      await requestDelete(space.key, page.id, fetchImpl);
      // Stays busy: the space overview replaces this screen.
      router.replace(spaceHref(space.key));
    } catch (error) {
      setAlert(deleteFailureMessage(error));
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("pageDelete.title", { title: page.title })}
      description={deleteConfirmation(page.descendantCount)}
      onDismiss={dismiss}
      testId="delete-page-dialog"
    >
      <DialogAlert message={alert} />
      <DialogStatus message={busy ? t("pageDelete.busy") : ""} />
      <DialogFooter>
        <button type="button" className={dialogSecondaryClass} aria-disabled={busy || undefined} onClick={dismiss} data-autofocus="">
          {t("pageView.dialog.cancel")}
        </button>
        <button
          type="button"
          className={dialogPrimaryClass}
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          onClick={() => void confirm()}
        >
          {t("pageDelete.confirm")}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
