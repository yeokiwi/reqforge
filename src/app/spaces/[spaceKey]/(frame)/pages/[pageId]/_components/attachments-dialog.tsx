"use client";

// 📎 and `···` → Attachments (10 section 4.1, RD-059). The page's live attachments (08 section 3:
// newest first) with name, size, who uploaded it and when; the name downloads the file from its
// attachment URL (RD-058), and an image also shows a small thumbnail from that URL. A viewer who
// may edit can upload a file (one at a time; empty files and files over 10 MiB are refused before
// anything is sent, RD-071) and hide one — "deleting an attachment hides it" (RD-058), confirmed
// first. The list is fetched again after each change.
//
// The dialog may be closed while an upload runs: the request carries on, and nothing on the page
// view depends on its outcome.
// spec: docs/specs/10-ui-reference.md section 4.1 (📎, `···` → Attachments); docs/specs/09-decision-log.md sections RD-058, RD-059, RD-071, RD-075
import { useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/copy";
import type { AttachmentRef, PageDetail } from "@/domain/documents/api-types";
import { LIMITS } from "@/domain/documents/limits";
import type { FetchLike } from "@/ui/api-client";
import { ConfirmDialog, Dialog } from "@/ui/dialog";
import { formatDateTime } from "@/ui/time";
import {
  failureCode,
  formatFileSize,
  hideFailureMessage,
  mibText,
  precheckUpload,
  uploadFailureMessage,
  uploadRefusalMessage,
} from "../_lib/dialog-messages";
import { fetchAttachments, requestHide, requestUpload } from "../_lib/page-requests";
import { DialogAlert, DialogFooter, DialogStatus, dialogPrimaryClass, dialogSecondaryClass } from "./dialog-parts";

export interface AttachmentsDialogProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  readonly onClose: () => void;
  readonly fetchImpl?: FetchLike;
}

type ListState = { readonly kind: "loading" } | { readonly kind: "error" } | { readonly kind: "ready"; readonly items: readonly AttachmentRef[] };
type Notice = { readonly kind: "status" | "alert"; readonly message: string } | null;

const cell = "border-b border-slate-200 px-2 py-2 align-middle";
const headCell = "border-b border-slate-300 bg-table-header px-2 py-1.5 text-left text-xs font-semibold text-slate-700";

// spec: docs/specs/09-decision-log.md sections RD-058 (attachments; hiding keeps the bytes), RD-059 (Attachments is built)
export function AttachmentsDialog({ space, page, onClose, fetchImpl }: AttachmentsDialogProps) {
  const router = useRouter();
  const canEdit = page.permissions.canEdit;
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmHide, setConfirmHide] = useState<AttachmentRef | null>(null);
  const loads = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);

  /** Fetches the list; only the newest request's answer is shown. */
  const load = useCallback(
    async (showLoading: boolean) => {
      const seq = ++loads.current;
      if (showLoading) setList({ kind: "loading" });
      try {
        const items = await fetchAttachments(space.key, page.id, fetchImpl);
        if (seq === loads.current) setList({ kind: "ready", items });
      } catch {
        if (seq === loads.current) setList({ kind: "error" });
      }
    },
    [space.key, page.id, fetchImpl],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const begin = (): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    return true;
  };
  const end = () => {
    busyRef.current = false;
    setBusy(false);
    setUploading(null);
  };

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again is a change again.
    event.target.value = "";
    if (file === undefined || busyRef.current) return;
    const name = file.name === "" ? "file" : file.name;
    const refusal = precheckUpload(file);
    if (refusal !== null) {
      setNotice({ kind: "alert", message: uploadRefusalMessage(refusal, name) });
      return;
    }
    if (!begin()) return;
    setUploading(name);
    try {
      await requestUpload(space.key, page.id, file, name, fetchImpl);
      setNotice({ kind: "status", message: t("pageAttachments.uploaded", { name }) });
      router.refresh();
      await load(false);
    } catch (error) {
      setNotice({ kind: "alert", message: uploadFailureMessage(error, name) });
    } finally {
      end();
    }
  };

  const hide = async (attachment: AttachmentRef) => {
    setConfirmHide(null);
    if (!begin()) return;
    const name = attachment.filename;
    try {
      await requestHide(space.key, page.id, attachment.id, fetchImpl);
      setNotice({ kind: "status", message: t("pageAttachments.hidden", { name }) });
      router.refresh();
      await load(false);
      // Its row, and the Hide button that had the focus, are gone.
      uploadButton.current?.focus();
    } catch (error) {
      setNotice({ kind: "alert", message: hideFailureMessage(error, name) });
      if (failureCode(error) === "NOT_FOUND") {
        await load(false);
        uploadButton.current?.focus();
      }
    } finally {
      end();
    }
  };

  const status = uploading !== null ? t("pageAttachments.uploading", { name: uploading }) : notice?.kind === "status" ? notice.message : "";

  return (
    <Dialog title={t("pageAttachments.title")} onDismiss={onClose} testId="attachments-dialog" size="wide">
      {canEdit ? (
        <div className="mt-4">
          <button
            ref={uploadButton}
            type="button"
            className={dialogPrimaryClass}
            aria-disabled={busy || undefined}
            aria-busy={uploading !== null || undefined}
            onClick={() => {
              if (!busyRef.current) fileInput.current?.click();
            }}
            data-autofocus=""
          >
            {t("pageAttachments.upload")}
          </button>
          <input ref={fileInput} type="file" hidden tabIndex={-1} onChange={(event) => void onFileChosen(event)} data-testid="attachment-file" />
          <p className="mt-1 text-xs text-slate-600">{t("pageAttachments.upload.help", { mib: mibText(LIMITS.attachmentMaxBytes) })}</p>
        </div>
      ) : null}

      <DialogStatus message={status} visible testId="attachments-status" />
      <DialogAlert message={notice?.kind === "alert" ? notice.message : null} />

      <div className="mt-3" data-testid="attachments-list">
        {list.kind === "loading" ? <p className="text-sm text-slate-600">{t("pageAttachments.loading")}</p> : null}
        {list.kind === "error" ? (
          <div className="flex items-center gap-3 text-sm">
            <p role="alert" className="text-red-700">
              {t("pageAttachments.loadFailed")}
            </p>
            <button type="button" className={dialogSecondaryClass} onClick={() => void load(true)}>
              {t("pageAttachments.retry")}
            </button>
          </div>
        ) : null}
        {list.kind === "ready" && list.items.length === 0 ? <p className="text-sm text-slate-600">{t("pageAttachments.empty")}</p> : null}
        {list.kind === "ready" && list.items.length > 0 ? (
          <table className="w-full border-collapse text-sm" aria-label={t("pageAttachments.table", { title: page.title })}>
            <thead>
              <tr>
                <th scope="col" className={headCell}>
                  {t("pageAttachments.col.name")}
                </th>
                <th scope="col" className={headCell}>
                  {t("pageAttachments.col.size")}
                </th>
                <th scope="col" className={headCell}>
                  {t("pageAttachments.col.uploadedBy")}
                </th>
                <th scope="col" className={headCell}>
                  {t("pageAttachments.col.uploaded")}
                </th>
                {canEdit ? (
                  <th scope="col" className={headCell}>
                    {t("pageAttachments.col.actions")}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {list.items.map((attachment) => (
                <tr key={attachment.id} data-testid="attachment-row">
                  <td className={cell}>
                    <span className="flex min-w-0 items-center gap-2">
                      {attachment.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- attachment bytes, served by our own API (RD-058)
                        <img
                          src={attachment.url}
                          alt=""
                          width={32}
                          height={32}
                          loading="lazy"
                          className="h-8 w-8 shrink-0 rounded border border-slate-200 object-cover"
                          data-testid="attachment-thumbnail"
                        />
                      ) : null}
                      <a href={attachment.url} download={attachment.filename} className="min-w-0 break-all">
                        {attachment.filename}
                      </a>
                    </span>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>{formatFileSize(attachment.size)}</td>
                  <td className={cell}>{attachment.uploadedBy.name}</td>
                  <td className={`${cell} whitespace-nowrap`}>
                    <time dateTime={attachment.createdAt}>{formatDateTime(attachment.createdAt)}</time>
                  </td>
                  {canEdit ? (
                    <td className={cell}>
                      <button
                        type="button"
                        className={dialogSecondaryClass}
                        aria-label={t("pageAttachments.hide.label", { name: attachment.filename })}
                        aria-disabled={busy || undefined}
                        onClick={() => {
                          if (!busyRef.current) setConfirmHide(attachment);
                        }}
                      >
                        {t("pageAttachments.hide")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <DialogFooter>
        <button type="button" className={dialogSecondaryClass} onClick={onClose} data-autofocus={canEdit ? undefined : ""}>
          {t("pageView.dialog.close")}
        </button>
      </DialogFooter>

      {confirmHide !== null ? (
        <ConfirmDialog
          title={t("pageAttachments.hide.title", { name: confirmHide.filename })}
          description={t("pageAttachments.hide.body")}
          confirmLabel={t("pageAttachments.hide")}
          cancelLabel={t("pageView.dialog.cancel")}
          onConfirm={() => void hide(confirmHide)}
          onCancel={() => setConfirmHide(null)}
          testId="hide-attachment-dialog"
        />
      ) : null}
    </Dialog>
  );
}
