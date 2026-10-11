"use client";

// The page actions at the right of the header row (10 section 4.1), in the video's order:
//
//   ✎ Edit   ☆ Save for later   ◉ Watching   ⇪ Share   ···
//
// Edit is a link to the editor, present only when the viewer may edit and is on the current
// version; `E` opens it too (never while typing, never with a modifier). Save for later and
// Watching are per-user toggle buttons (aria-pressed) that change at once and roll back if the
// server refuses (RD-061). Share copies the page's absolute URL and says so politely (RD-061).
// The `···` menu is passed in by the header, which owns the dialogs it opens.
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md sections RD-059, RD-060, RD-061
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type ParamlessCopyId, t } from "@/copy";
import { StarIcon } from "@/ui/icons";
import { type FetchLike, callApi } from "@/ui/api-client";
import { PencilIcon, ShareIcon, WatchIcon } from "@/ui/page-view/icons";
import { absoluteUrl, copyText } from "../_lib/clipboard";
import { isEditShortcut } from "../_lib/edit-shortcut";

const actionClass =
  "inline-flex h-8 items-center gap-1.5 rounded px-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-100 hover:text-slate-900";
const pressedClass = "text-action-primary";

/** How long `Link copied` stays on screen. */
export const SHARE_CONFIRMATION_MS = 3000;

// ------------------------------------------------------------------------------------ Edit

export interface EditActionProps {
  readonly href: string;
  /** Off while a dialog is open: its keys are its own. */
  readonly shortcutEnabled: boolean;
}

/** `✎ Edit`, and the `E` key. */
// spec: docs/specs/10-ui-reference.md section 4.1 (`✎ Edit` opens the editor, §5; also `E`)
export function EditAction({ href, shortcutEnabled }: EditActionProps) {
  const router = useRouter();
  useEffect(() => {
    if (!shortcutEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEditShortcut(event)) return;
      event.preventDefault();
      router.push(href);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [href, router, shortcutEnabled]);

  return (
    <Link href={href} aria-keyshortcuts="E" className={actionClass} data-testid="page-edit">
      <PencilIcon />
      {t("page.edit")}
    </Link>
  );
}

// --------------------------------------------------------------------------------- toggles

export interface ToggleActionProps {
  readonly label: ParamlessCopyId;
  /** What the server said, at render. */
  readonly pressed: boolean;
  /** PUT turns it on, DELETE turns it off (08 §3: idempotent 204). */
  readonly url: string;
  readonly failedMessage: ParamlessCopyId;
  readonly icon: (pressed: boolean) => ReactNode;
  readonly onFailure: (message: ParamlessCopyId) => void;
  readonly onSuccess: () => void;
  readonly fetchImpl?: FetchLike;
  readonly testId?: string;
}

/**
 * A per-user toggle. It flips at once (optimistic) and rolls back when the request fails; a
 * press while a request is in flight is ignored, so the shown state is always the last one sent.
 */
// spec: docs/specs/09-decision-log.md section RD-061 (`Watching` and `Save for later` are per-user toggles)
export function ToggleAction({ label, pressed: serverPressed, url, failedMessage, icon, onFailure, onSuccess, fetchImpl, testId }: ToggleActionProps) {
  const [pressed, setPressed] = useState(serverPressed);
  const [seen, setSeen] = useState(serverPressed);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // A refresh brought the server's value: follow it.
  if (seen !== serverPressed) {
    setSeen(serverPressed);
    setPressed(serverPressed);
  }

  const toggle = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const next = !pressed;
    setPressed(next);
    try {
      await callApi(next ? "PUT" : "DELETE", url, undefined, fetchImpl);
      onSuccess();
    } catch {
      setPressed(!next);
      onFailure(failedMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      className={`${actionClass} ${pressed ? pressedClass : ""}`}
      onClick={() => void toggle()}
      data-testid={testId}
    >
      {icon(pressed)}
      {t(label)}
    </button>
  );
}

// ----------------------------------------------------------------------------------- Share

export interface ShareActionProps {
  /** The page's own path, `/spaces/{SPACE}/pages/{id}`. */
  readonly path: string;
  readonly onCopied: () => void;
  readonly onFailure: (message: ParamlessCopyId) => void;
}

/** `⇪ Share`: copy link only (RD-059, RD-061). */
// spec: docs/specs/09-decision-log.md sections RD-059 and RD-061 (`Share` is copy-link only)
export function ShareAction({ path, onCopied, onFailure }: ShareActionProps) {
  const share = async () => {
    const copied = await copyText(absoluteUrl(path, window.location.origin), {
      clipboard: typeof navigator === "undefined" ? undefined : navigator.clipboard,
      document,
    });
    if (copied) onCopied();
    else onFailure("pageShare.failed");
  };
  return (
    <button type="button" className={actionClass} onClick={() => void share()} data-testid="page-share">
      <ShareIcon />
      {t("page.share")}
    </button>
  );
}

// ---------------------------------------------------------------------------------- the row

export interface PageActionsProps {
  readonly page: { readonly favourite: boolean; readonly watching: boolean };
  /** Present only when the viewer may edit and is on the current version (RD-060). */
  readonly editHref: string | null;
  /** The page's own path, for Share. */
  readonly viewHref: string;
  /** `/api/v1/…/favourite` and `/api/v1/…/watch`. */
  readonly favouriteUrl: string;
  readonly watchUrl: string;
  /** False while a dialog is open. */
  readonly shortcutEnabled: boolean;
  /** The `···` menu, last in the row. */
  readonly menu: ReactNode;
  readonly fetchImpl?: FetchLike;
}

type Notice = { readonly kind: "status" | "alert"; readonly message: ParamlessCopyId } | null;

export function PageActions({ page, editHref, viewHref, favouriteUrl, watchUrl, shortcutEnabled, menu, fetchImpl }: PageActionsProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = (next: Notice, clearAfterMs?: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(next);
    if (clearAfterMs !== undefined) timer.current = setTimeout(() => setNotice(null), clearAfterMs);
  };
  const fail = (message: ParamlessCopyId) => show({ kind: "alert", message });
  // A toggle that stuck clears its failure and refreshes the server's view of the page, so what
  // else reads PageDetail (Page information's `Watching`) agrees with the button.
  const toggled = () => {
    setNotice((current) => (current?.kind === "alert" ? null : current));
    router.refresh();
  };

  // The confirmation and the failure float under the row, so neither moves the title when it appears.
  const floating = "absolute right-0 top-full z-20 mt-1 max-w-xs rounded bg-white px-2 py-1 text-right text-xs shadow";
  return (
    <div className="relative shrink-0">
      <div role="group" aria-label={t("pageView.actions")} className="flex items-center gap-1" data-testid="page-actions">
        {editHref !== null ? <EditAction href={editHref} shortcutEnabled={shortcutEnabled} /> : null}
        <ToggleAction
          label="page.saveForLater"
          pressed={page.favourite}
          url={favouriteUrl}
          failedMessage="pageView.favourite.failed"
          icon={(on) => <StarIcon size={18} filled={on} />}
          onFailure={fail}
          onSuccess={toggled}
          fetchImpl={fetchImpl}
          testId="page-favourite"
        />
        <ToggleAction
          label="page.watching"
          pressed={page.watching}
          url={watchUrl}
          failedMessage="pageView.watch.failed"
          icon={(on) => <WatchIcon on={on} />}
          onFailure={fail}
          onSuccess={toggled}
          fetchImpl={fetchImpl}
          testId="page-watching"
        />
        <ShareAction path={viewHref} onCopied={() => show({ kind: "status", message: "pageShare.copied" }, SHARE_CONFIRMATION_MS)} onFailure={fail} />
        {menu}
      </div>
      {/* Present before anything is said, so screen readers announce what appears in it. */}
      <p
        role="status"
        aria-live="polite"
        className={notice?.kind === "status" ? `${floating} text-slate-700` : "sr-only"}
        data-testid="page-actions-status"
      >
        {notice?.kind === "status" ? t(notice.message) : null}
      </p>
      {notice?.kind === "alert" ? (
        <p role="alert" className={`${floating} text-red-700`}>
          {t(notice.message)}
        </p>
      ) : null}
    </div>
  );
}
