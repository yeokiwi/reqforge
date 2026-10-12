"use client";

// The top bar's `Create` (10 section 2, RD-052, RD-056). Inside a space the viewer can edit it
// makes the page at once — `POST /api/v1/spaces/{KEY}/pages` with no body: an empty `Untitled`
// page at the root of the space — and opens the editor on it (RD-056). Elsewhere it is the
// `Choose a space` picker (RD-052), and picking a space does the same there. 10 section 2's row
// still carries the interim rule "until pages exist (slice 1) it is disabled inside a space the
// user can edit"; slice 1 ends that period, and the row's own first clause ("new page in the
// current space") is what is built — the row's stale sentence is handed to spec-keeper.
//
// One request at a time: a second press while one is in flight does nothing, so a double click
// makes one page. After a success the lock is held until the browser navigates — the editor
// normally replaces this whole frame — or for CREATE_LOCK_MS, whichever comes first: the top bar
// lives in the frame's persistent layout, so if the push to the editor is superseded by another
// click or bounced back into the frame, this same button stays on screen and must work again.
// A refusal is an alert with a copy-deck string chosen by the problem's `code` (08 §3.2).
// spec: docs/specs/10-ui-reference.md section 2 (`Create`: "new page in the current space, or space picker outside one"); docs/specs/09-decision-log.md sections RD-052, RD-056
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ParamlessCopyId, t } from "@/copy";
import { ApiError, type FetchLike, callApi, spaceUrls } from "./api-client";
import { Menu, MenuItemDisabled, MenuLabel, menuItemButtonClass } from "./menu";
import { CloseIcon } from "./page-view/icons";
import { pageEditHref } from "./page-view/urls";

/**
 * After a successful create, how long a press still does nothing when no navigation has happened.
 * The same hold as the page tree's own create (src/ui/page-tree/store.ts).
 */
export const CREATE_LOCK_MS = 5000;

export interface CreatePageButtonProps {
  /** The space whose screen this is, when the viewer can edit it there; else null (the picker). */
  readonly spaceKey: string | null;
  /** The spaces the viewer can edit, for the picker. */
  readonly creatableSpaces: readonly { readonly key: string; readonly name: string }[];
  /** Tests only. */
  readonly fetchImpl?: FetchLike;
}

const createClass =
  "inline-flex items-center rounded bg-action-create px-4 py-2 text-sm font-semibold text-white no-underline hover:brightness-110 aria-disabled:cursor-progress aria-disabled:opacity-70";

/** The alert for a refused create, by the problem's `code`. */
// spec: docs/specs/08-api-surface.md section 3.2 (clients branch on `code`); RD-051 (an invisible space is not found)
export function createFailureMessage(error: unknown): ParamlessCopyId {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "FORBIDDEN") return "create.failed.forbidden";
  if (code === "NOT_FOUND") return "create.failed.notFound";
  return "create.failed";
}

/** Where to go after a create: the new page's editor. Null when the answer is not a page. */
export function editHrefOf(created: unknown): string | null {
  if (typeof created !== "object" || created === null) return null;
  const { id, spaceKey } = created as { id?: unknown; spaceKey?: unknown };
  if (typeof id !== "string" || id === "" || typeof spaceKey !== "string" || spaceKey === "") return null;
  return pageEditHref(spaceKey, id);
}

// spec: docs/specs/09-decision-log.md section RD-056 (`Create` makes the page immediately, then opens the editor)
export function CreatePageButton({ spaceKey, creatableSpaces, fetchImpl }: CreatePageButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ParamlessCopyId | null>(null);
  const busyRef = useRef(false);
  /** Set while a successful create holds the lock (it is waiting for the editor). */
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseLock = useCallback(() => {
    if (lockTimer.current === null) return; // no create is waiting for its navigation
    clearTimeout(lockTimer.current);
    lockTimer.current = null;
    busyRef.current = false;
    setBusy(false);
  }, []);

  // A navigation that left this button on screen: the editor did not replace the frame. A POST
  // still in flight keeps its lock (freeing it would let a second press make a second page).
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (pathname === seenPath.current) return;
    seenPath.current = pathname;
    releaseLock();
  }, [pathname, releaseLock]);

  useEffect(
    () => () => {
      if (lockTimer.current !== null) clearTimeout(lockTimer.current);
    },
    [],
  );
  // The shared Menu has no way for a button item to close it; a new key remounts it closed.
  const [menuGeneration, setMenuGeneration] = useState(0);
  const pickerAnchor = useRef<HTMLDivElement>(null);
  const [refocusPicker, setRefocusPicker] = useState(false);

  useEffect(() => {
    if (!refocusPicker) return;
    setRefocusPicker(false);
    pickerAnchor.current?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.focus();
  }, [refocusPicker]);

  const create = async (key: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const href = editHrefOf(await callApi("POST", spaceUrls(key).pages, undefined, fetchImpl));
      if (href === null) throw new ApiError("UNEXPECTED_RESPONSE", 0);
      // Stays busy: the editor replaces this screen, and a second press must not make a second page
      // — until a navigation that leaves this button on screen, or CREATE_LOCK_MS.
      router.push(href);
      lockTimer.current = setTimeout(releaseLock, CREATE_LOCK_MS);
    } catch (error) {
      busyRef.current = false;
      setBusy(false);
      setFailure(createFailureMessage(error));
    }
  };

  const alert =
    failure !== null ? (
      <div role="alert" className="absolute left-0 top-full z-30 mt-2 flex w-72 items-start gap-2 rounded bg-white p-3 text-sm text-red-700 shadow-lg">
        <span className="flex-1">{t(failure)}</span>
        <button
          type="button"
          aria-label={t("create.dismiss")}
          title={t("create.dismiss")}
          className="rounded px-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => setFailure(null)}
        >
          <CloseIcon size={14} />
        </button>
      </div>
    ) : null;

  if (spaceKey !== null) {
    return (
      <div className="relative">
        <button
          type="button"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          className={createClass}
          onClick={() => void create(spaceKey)}
          data-testid="create-page"
        >
          {t("shell.create")}
        </button>
        {alert}
      </div>
    );
  }

  return (
    <div ref={pickerAnchor} className="relative">
      <Menu key={menuGeneration} label={t("shell.create")} trigger={t("shell.create")} triggerClassName={createClass} testId="create-picker">
        <MenuLabel>{t("shell.create.pickSpace")}</MenuLabel>
        {creatableSpaces.length > 0 ? (
          creatableSpaces.map((space) => (
            <button
              key={space.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={busy || undefined}
              className={menuItemButtonClass}
              onClick={() => {
                if (busyRef.current) return;
                setMenuGeneration((g) => g + 1);
                setRefocusPicker(true);
                void create(space.key);
              }}
            >
              {space.name}
            </button>
          ))
        ) : (
          <MenuItemDisabled>{t("shell.create.noSpace")}</MenuItemDisabled>
        )}
      </Menu>
      {alert}
    </div>
  );
}
