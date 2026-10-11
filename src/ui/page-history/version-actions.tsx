"use client";

// A Page History row's `Restore  Delete` (10 section 23, RD-060).
//
// Restore asks first (it publishes the old version as a new current one, on top), then calls
// POST …/versions/{n}/restore and opens the page view on the result. Delete asks first (it is
// permanent), calls DELETE …/versions/{n}, drops the version from the compare selection and
// re-renders the list. One action at a time across the whole table: the store's begin() is the
// double-submit guard, and every Restore and Delete is unavailable while one is in flight.
// A refusal is an alert with the copy-deck string its problem `code` maps to (messages.ts).
// spec: docs/specs/10-ui-reference.md section 23; docs/specs/09-decision-log.md section RD-060; docs/specs/08-api-surface.md section 3.2
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { t } from "@/copy";
import { callApi, spaceUrls } from "@/ui/api-client";
import { ConfirmDialog } from "@/ui/dialog";
import { useHistory, usePending } from "./history-context";
import { deleteFailure, restoreFailure } from "./messages";
import type { DeleteAction } from "./row-actions";
import { pageHref } from "./urls";

export interface VersionActionsProps {
  readonly version: number;
  /** Offer Restore (space EDIT). */
  readonly restore: boolean;
  readonly delete: DeleteAction;
}

const actionClass =
  "rounded px-1 text-sm text-link hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:no-underline";

export function VersionActions({ version, restore, delete: deletion }: VersionActionsProps) {
  const { store, spaceKey, pageId, fetchImpl, noticeRef } = useHistory();
  const router = useRouter();
  const pending = usePending();
  const [asking, setAsking] = useState<"restore" | "delete" | null>(null);
  const reasonId = useId();
  const busy = pending !== null;

  const runRestore = async () => {
    setAsking(null);
    if (!store.begin({ kind: "restore", version })) return;
    store.setNotice({ tone: "status", text: t("history.restoring", { n: version }) });
    try {
      await callApi("POST", spaceUrls(spaceKey).restore(pageId, version), undefined, fetchImpl);
    } catch (error) {
      const outcome = restoreFailure(error, version);
      if (outcome.drop) store.setSelected(version, false);
      store.end();
      store.setNotice({ tone: "error", text: outcome.text });
      if (outcome.refresh) router.refresh();
      return;
    }
    // The restored copy is now the current version: show it. The action slot stays claimed —
    // this screen is being left, and a second press must not restore again on the way out.
    router.push(pageHref(spaceKey, pageId));
    router.refresh();
  };

  const runDelete = async () => {
    setAsking(null);
    if (!store.begin({ kind: "delete", version })) return;
    store.setNotice({ tone: "status", text: t("history.deleting", { n: version }) });
    try {
      await callApi("DELETE", spaceUrls(spaceKey).version(pageId, version), undefined, fetchImpl);
    } catch (error) {
      const outcome = deleteFailure(error, version);
      if (outcome.drop) store.setSelected(version, false);
      store.end();
      store.setNotice({ tone: "error", text: outcome.text });
      if (outcome.refresh) router.refresh();
      return;
    }
    store.setSelected(version, false);
    store.end();
    store.setNotice({ tone: "status", text: t("history.deleted", { n: version }) });
    // This row is about to go, and the focused Delete with it: keep focus on the message.
    noticeRef.current?.focus();
    router.refresh();
  };

  const ask = (what: "restore" | "delete") => {
    if (store.pending() !== null) return;
    setAsking(what);
  };

  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      {restore ? (
        <button
          type="button"
          className={actionClass}
          aria-label={t("history.restore.label", { n: version })}
          aria-disabled={busy ? "true" : undefined}
          aria-busy={pending?.kind === "restore" && pending.version === version ? "true" : undefined}
          onClick={() => ask("restore")}
          data-testid={`history-restore-${version}`}
        >
          {t("history.restore")}
        </button>
      ) : null}
      {deletion.kind === "enabled" ? (
        <button
          type="button"
          className={actionClass}
          aria-label={t("history.delete.label", { n: version })}
          aria-disabled={busy ? "true" : undefined}
          aria-busy={pending?.kind === "delete" && pending.version === version ? "true" : undefined}
          onClick={() => ask("delete")}
          data-testid={`history-delete-${version}`}
        >
          {t("history.delete")}
        </button>
      ) : null}
      {deletion.kind === "disabled" ? (
        <>
          <button
            type="button"
            className={actionClass}
            aria-label={t("history.delete.label", { n: version })}
            aria-disabled="true"
            aria-describedby={reasonId}
            title={deletion.reason}
            data-testid={`history-delete-${version}`}
          >
            {t("history.delete")}
          </button>
          <span id={reasonId} className="sr-only">
            {deletion.reason}
          </span>
        </>
      ) : null}

      {asking === "restore" ? (
        <ConfirmDialog
          title={t("history.restore.title", { n: version })}
          description={t("history.restore.body", { n: version })}
          confirmLabel={t("history.restore")}
          cancelLabel={t("history.cancel")}
          onConfirm={() => void runRestore()}
          onCancel={() => setAsking(null)}
          testId="history-restore-dialog"
        />
      ) : null}
      {asking === "delete" ? (
        <ConfirmDialog
          title={t("history.delete.title", { n: version })}
          description={t("history.delete.body", { n: version })}
          confirmLabel={t("history.delete")}
          cancelLabel={t("history.cancel")}
          onConfirm={() => void runDelete()}
          onCancel={() => setAsking(null)}
          testId="history-delete-dialog"
        />
      ) : null}
    </div>
  );
}
