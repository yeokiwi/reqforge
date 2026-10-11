"use client";

// The dialogs behind the page view's `···` menu and the 📎 byline icon (10 section 4.1, RD-059):
// Attachments, Page information, Copy, Move, Delete. This file is the seam between the two
// passes of the page-view unit: pass 1 opens a dialog by setting `kind` (page-header.tsx holds
// that state); pass 2 implements the dialogs here, on the shared Dialog / ConfirmDialog of
// src/ui/dialog.tsx, calling the REST API (src/ui/api-client.ts) and then router.refresh() or
// navigating. Until then nothing renders.
//
// The props are the contract:
//   kind     which dialog is open; the component renders only while it is non-null
//   page     the page as the viewer sees it (PageDetail): permissions, descendantCount, title …
//   space    { key, name } of the page's space
//   pages    the whole space's live tree, flat (PageSummary[]), for the Move picker
//   onClose  close the dialog; the header then returns focus to the control that opened it
// spec: docs/specs/10-ui-reference.md section 4.1 (`···`); docs/specs/09-decision-log.md sections RD-056, RD-058, RD-059
import type { PageDetail, PageSummary } from "@/domain/documents";

/** The dialogs the page view can open. The 📎 icon and the menu's Attachments open the same one. */
export type PageDialogKind = "attachments" | "info" | "copy" | "move" | "delete";

export interface PageDialogsProps {
  readonly kind: PageDialogKind;
  readonly page: PageDetail;
  readonly space: { readonly key: string; readonly name: string };
  /** The whole space's live tree, flat, ordered by ordinal within parentId (listPageTree). */
  readonly pages: readonly PageSummary[];
  readonly onClose: () => void;
}

// spec: docs/specs/09-decision-log.md section RD-059 (Attachments, Page information, Copy, Move, Delete are built)
export function PageDialogs(props: PageDialogsProps) {
  void props;
  return null;
}
