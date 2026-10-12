"use client";

// The dialogs behind the page view's `···` menu and the 📎 byline icon (10 section 4.1, RD-059):
// Attachments, Page information, Copy, Move, Delete — one file each, all on the shared Dialog of
// src/ui/dialog.tsx, calling the REST API (src/ui/api-client.ts through _lib/page-requests.ts).
// After every successful change they call router.refresh() so the header, the tree and the notices
// follow; Copy first opens the copy and Delete first replaces the screen with the space overview
// (the refresh then runs on the new URL).
//
// The props are the contract with page-header.tsx (pass 1):
//   kind     which dialog is open; null renders nothing
//   page     the page as the view rendered it (PageDetail): permissions, title …
//   space    { key, name } of the page's space
//   onClose  close the dialog. Focus then goes back to what opened it: the shared Dialog returns
//            it to the 📎 icon, and the header puts it on the `···` button when a menu item
//            opened the dialog (that item is gone by then).
// The space's tree is not a prop: Move and Copy read the frame's live PageTreeStore (the one the
// sidebar shows), and Delete counts the subtree afresh from the server as it opens.
// spec: docs/specs/10-ui-reference.md section 4.1 (`···`); docs/specs/09-decision-log.md sections RD-056, RD-058, RD-059
import type { PageDetail } from "@/domain/documents/api-types";
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
  readonly onClose: () => void;
  /** Tests only: the server cannot pass a function to a client component. */
  readonly fetchImpl?: FetchLike;
}

// spec: docs/specs/09-decision-log.md section RD-059 (Attachments, Page information, Copy, Move, Delete are built)
export function PageDialogs({ kind, page, space, onClose, fetchImpl }: PageDialogsProps) {
  switch (kind) {
    case null:
      return null;
    case "attachments":
      return <AttachmentsDialog space={space} page={page} onClose={onClose} fetchImpl={fetchImpl} />;
    case "info":
      return <PageInfoDialog space={space} page={page} onClose={onClose} />;
    case "copy":
      return <CopyPageDialog space={space} page={page} onClose={onClose} fetchImpl={fetchImpl} />;
    case "move":
      return <MovePageDialog space={space} page={page} onClose={onClose} fetchImpl={fetchImpl} />;
    case "delete":
      return <DeletePageDialog space={space} page={page} onClose={onClose} fetchImpl={fetchImpl} />;
  }
}
