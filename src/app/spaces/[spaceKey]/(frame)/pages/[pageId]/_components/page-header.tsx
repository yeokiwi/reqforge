"use client";

// The page view's top row (10 section 4):
//
//   Pages / Specifications  🔓 📎 ⛹                 ✎ Edit   ☆ Save for later   ◉ Watching   ⇪ Share   ···
//
// It owns which dialog is open (PageDialogKind | null): the 📎 icon and the `···` menu's dialog
// items open one, <PageDialogs> renders it, and when it closes focus goes back to the control
// that opened it (the menu's own item is gone by then, so the `···` button takes it).
//
// The breadcrumb's ancestors are the frame's live tree's (the PageTreeStore the sidebar shows),
// so a move made in the sidebar or from this view shows here at once; the render's crumbs are the
// fallback while the tree does not have the page. While the header is shown it counts as one of
// the tree's consumers, so the store refetches on navigation even when the sidebar is collapsed.
// spec: docs/specs/10-ui-reference.md sections 3.2 and 4.1; docs/specs/09-decision-log.md sections RD-056, RD-059, RD-078
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageDetail } from "@/domain/documents";
import { type FetchLike, spaceUrls } from "@/ui/api-client";
import { Breadcrumb, type Crumb, pageCrumbs } from "@/ui/page-view/breadcrumb";
import { liveAncestors } from "../_lib/live-tree";
import { BylineIcons } from "./byline-icons";
import { PageActions } from "./page-actions";
import { type PageDialogKind, PageDialogs } from "./page-dialogs";
import { PageMenu } from "./page-menu";
import { useLiveTree } from "./use-live-tree";

export interface PageHeaderProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  /** The render's crumbs (PageDetail.ancestors): shown while the live tree does not have the page. */
  readonly crumbs: readonly Crumb[];
  /** The page's own path (Share copies it). */
  readonly viewHref: string;
  /** The editor's path when Edit is offered (EDIT, current version); else null. */
  readonly editHref: string | null;
  /** Tests only: the server cannot pass a function to a client component. */
  readonly fetchImpl?: FetchLike;
}

type Opener = "menu" | "attachments";

export function PageHeader({ space, page, crumbs: renderedCrumbs, viewHref, editHref, fetchImpl }: PageHeaderProps) {
  const { store, model } = useLiveTree();
  const crumbs = useMemo(() => {
    const ancestors = liveAncestors(model, page.id);
    return ancestors === null ? renderedCrumbs : pageCrumbs(space.key, ancestors, page.title);
  }, [model, page.id, page.title, space.key, renderedCrumbs]);
  useEffect(() => store.retain(), [store]);
  const [dialog, setDialog] = useState<PageDialogKind | null>(null);
  const opener = useRef<Opener | null>(null);
  const menuAnchor = useRef<HTMLDivElement>(null);
  const attachmentsButton = useRef<HTMLButtonElement>(null);
  const urls = spaceUrls(space.key);

  const open = (kind: PageDialogKind, from: Opener) => {
    opener.current = from;
    setDialog(kind);
  };

  // After a dialog closes (and has done its own focus restoring), put focus on its opener.
  useEffect(() => {
    if (dialog !== null || opener.current === null) return;
    const from = opener.current;
    opener.current = null;
    if (from === "attachments") attachmentsButton.current?.focus();
    else menuAnchor.current?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.focus();
  }, [dialog]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="page-header">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Breadcrumb crumbs={crumbs} />
        <BylineIcons onOpenAttachments={() => open("attachments", "attachments")} attachmentsRef={attachmentsButton} />
      </div>
      <PageActions
        page={page}
        editHref={editHref}
        viewHref={viewHref}
        favouriteUrl={urls.favourite(page.id)}
        watchUrl={urls.watch(page.id)}
        shortcutEnabled={dialog === null}
        fetchImpl={fetchImpl}
        menu={
          <div ref={menuAnchor}>
            <PageMenu spaceKey={space.key} page={page} onOpenDialog={(kind) => open(kind, "menu")} />
          </div>
        }
      />
      {dialog !== null ? (
        <PageDialogs kind={dialog} page={page} space={space} onClose={() => setDialog(null)} fetchImpl={fetchImpl} />
      ) : null}
    </div>
  );
}
