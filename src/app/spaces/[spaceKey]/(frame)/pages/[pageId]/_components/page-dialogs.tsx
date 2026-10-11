"use client";

// The dialogs behind the page view's `···` menu and the 📎 byline icon (10 section 4.1, RD-059):
// Attachments, Page information, Copy, Move, Delete — one file each, all on the shared Dialog of
// src/ui/dialog.tsx, calling the REST API (src/ui/api-client.ts through _lib/page-requests.ts).
// After a change they call router.refresh() (attachments, move) so the header, the tree and the
// notices follow, or navigate: Copy opens the copy, Delete goes to the space overview.
//
// The props are the contract with page-header.tsx (pass 1):
//   kind     which dialog is open; null renders nothing
//   page     the page as the viewer sees it (PageDetail): permissions, descendantCount, title …
//   space    { key, name } of the page's space
//   pages    the whole space's live tree, flat (PageSummary[]), for Move and Copy
//   onClose  close the dialog. Focus then goes back to what opened it: the shared Dialog returns
//            it to the 📎 icon, and the header puts it on the `···` button when a menu item
//            opened the dialog (that item is gone by then).
// spec: docs/specs/10-ui-reference.md section 4.1 (`···`); docs/specs/09-decision-log.md sections RD-056, RD-058, RD-059
import type { PageDetail, PageSummary } from "@/domain/documents/api-types";
import type { FetchLike } from "@/ui/api-client";
import { AttachmentsDialog } from "./attachments-dialog";
import { CopyPageDialog } from "./copy-page-dialog";
import { DeletePageDialog } from "./delete-page-dialog";
import { MovePageDialog } from "./move-page-dialog";
import { PageInfoDialog } from "./page-info-dialog";

/** The dialogs the page view can open. The 📎 icon and the menu's Attachments open the same one. */
export type PageDialogKind = "attachments" | "info" | "copy" | "move" | "delete";

export interface PageDialogsProps {
  readonly kind: PageDialogKind | null;
  readonly page: PageDetail;
  readonly space: { readonly key: string; readonly name: string };
  /** The whole space's live tree, flat, ordered by ordinal within parentId (listPageTree). */
  readonly pages: readonly PageSummary[];
  readonly onClose: () => void;
  /** Tests only: the server cannot pass a function to a client component. */
  readonly fetchImpl?: FetchLike;
}

// spec: docs/specs/09-decision-log.md section RD-059 (Attachments, Page information, Copy, Move, Delete are built)
export function PageDialogs({ kind, page, space, pages, onClose, fetchImpl }: PageDialogsProps) {
  switch (kind) {
    case null:
      return null;
    case "attachments":
      return <AttachmentsDialog space={space} page={page} onClose={onClose} fetchImpl={fetchImpl} />;
    case "info":
      return <PageInfoDialog space={space} page={page} onClose={onClose} />;
    case "copy":
      return <CopyPageDialog space={space} page={page} pages={pages} onClose={onClose} fetchImpl={fetchImpl} />;
    case "move":
      return <MovePageDialog space={space} page={page} pages={pages} onClose={onClose} fetchImpl={fetchImpl} />;
    case "delete":
      return <DeletePageDialog space={space} page={page} onClose={onClose} fetchImpl={fetchImpl} />;
  }
}
