"use client";

// RD-055 says Close keeps the draft and Edit resumes it, but not what the page view shows in the
// meantime. Ours: a quiet notice, on the current version only, for the viewer's own draft, with
// `Continue editing` (the editor resumes the draft) and `Discard draft` (confirmed; deletes the
// draft, as the editor's Revert to last published does, then refreshes the page).
// spec: docs/specs/09-decision-log.md section RD-055 (Close keeps the draft; Revert deletes it)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { t } from "@/copy";
import { type FetchLike, callApi, spaceUrls } from "@/ui/api-client";
import { ConfirmDialog } from "@/ui/dialog";

export interface DraftNoticeProps {
  readonly spaceKey: string;
  readonly pageId: string;
  readonly editHref: string;
  readonly fetchImpl?: FetchLike;
}

/** `DELETE /api/v1/spaces/{key}/pages/{id}/draft` (08 §3: idempotent 204, EDIT). */
export function draftUrl(spaceKey: string, pageId: string): string {
  return `${spaceUrls(spaceKey).page(pageId)}/draft`;
}

// spec: docs/specs/09-decision-log.md section RD-055
export function DraftNotice({ spaceKey, pageId, editHref, fetchImpl }: DraftNoticeProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const busyRef = useRef(false);

  const discard = async () => {
    setConfirming(false);
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await callApi("DELETE", draftUrl(spaceKey, pageId), undefined, fetchImpl);
      setDiscarded(true);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (discarded) return null;
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 bg-surface-sidebar px-4 py-2 text-sm text-slate-800"
      data-testid="draft-notice"
    >
      <span>{t("pageView.draft.notice")}</span>
      <Link href={editHref}>{t("pageView.draft.continue")}</Link>
      <button
        type="button"
        aria-disabled={busy || undefined}
        className="rounded px-1 text-link hover:underline aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        onClick={() => {
          if (!busyRef.current) setConfirming(true);
        }}
      >
        {t("pageView.draft.discard")}
      </button>
      {failed ? (
        <p role="alert" className="basis-full text-red-700">
          {t("pageView.draft.discard.failed")}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={t("pageView.draft.discard.title")}
          description={t("pageView.draft.discard.body")}
          confirmLabel={t("pageView.draft.discard.confirm")}
          cancelLabel={t("pageView.draft.discard.cancel")}
          onConfirm={() => void discard()}
          onCancel={() => setConfirming(false)}
          testId="discard-draft-dialog"
        />
      ) : null}
    </div>
  );
}
