"use client";

// The page view's top row (10 section 4):
//
//   Pages / Specifications  🔓 📎 ⛹                 ✎ Edit   ☆ Save for later   ◉ Watching   ⇪ Share   ···
//
// It owns which dialog is open (PageDialogKind | null): the 📎 icon and the `···` menu's dialog
// items open one, <PageDialogs> renders it, and when it closes focus goes back to the control
// that opened it (the menu's own item is gone by then, so the `···` button takes it).
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md sections RD-059, RD-078
import { useEffect, useRef, useState } from "react";
import type { PageDetail, PageSummary } from "@/domain/documents";
import { type FetchLike, spaceUrls } from "@/ui/api-client";
import { Breadcrumb, type Crumb } from "@/ui/page-view/breadcrumb";
import { BylineIcons } from "./byline-icons";
import { PageActions } from "./page-actions";
import { type PageDialogKind, PageDialogs } from "./page-dialogs";
import { PageMenu } from "./page-menu";

export interface PageHeaderProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  /** The space's whole tree, for the Move dialog. */
  readonly pages: readonly PageSummary[];
  readonly crumbs: readonly Crumb[];
  /** The page's own path (Share copies it). */
  readonly viewHref: string;
  /** The editor's path when Edit is offered (EDIT, current version); else null. */
  readonly editHref: string | null;
  /** Tests only: the server cannot pass a function to a client component. */
  readonly fetchImpl?: FetchLike;
}

type Opener = "menu" | "attachments";

export function PageHeader({ space, page, pages, crumbs, viewHref, editHref, fetchImpl }: PageHeaderProps) {
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
        <PageDialogs kind={dialog} page={page} space={space} pages={pages} onClose={() => setDialog(null)} fetchImpl={fetchImpl} />
      ) : null}
    </div>
  );
}
