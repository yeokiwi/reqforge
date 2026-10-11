// What the page view's `···` menu offers, in the video's order (10 section 4.1, RD-059), for
// the viewer's permissions. Pure, so the order, the inert slots and the permission rules are
// tested without rendering.
// spec: docs/specs/10-ui-reference.md section 4.1 (`···`); docs/specs/09-decision-log.md section RD-059; docs/specs/07-permissions-and-limits.md section 2.4
import type { ParamlessCopyId } from "@/copy";
import type { PageDetail } from "@/domain/documents";
import { hierarchyHref, pageHistoryHref } from "@/ui/page-view/urls";
import type { PageDialogKind } from "../_components/page-dialogs";

export type PageMenuItemId =
  | "attachments"
  | "history"
  | "restrictions"
  | "peopleWhoCanView"
  | "info"
  | "hierarchy"
  | "exportWord"
  | "reqforge"
  | "copy"
  | "move"
  | "delete";

interface ItemBase {
  readonly id: PageMenuItemId;
  readonly label: ParamlessCopyId;
}

export type PageMenuItem =
  /** Built: navigates. */
  | (ItemBase & { readonly type: "link"; readonly href: string })
  /** Built: opens a dialog of PageDialogs. */
  | (ItemBase & { readonly type: "dialog"; readonly dialog: PageDialogKind })
  /** Drawn, inert: its slice has not shipped (RD-059). */
  | (ItemBase & { readonly type: "inert" });

/**
 * The menu for `page` in `spaceKey`. Every viewer gets Attachments, Page History, Page
 * information and View in Hierarchy (space VIEW, 07 §2.4) and the four inert slots; Copy, Move
 * and Delete need space EDIT, as their use cases do (07 §2.4), and are absent without it.
 */
// spec: docs/specs/09-decision-log.md section RD-059 (order; built vs. drawn inert); docs/specs/07-permissions-and-limits.md section 2.4
export function pageMenuItems(spaceKey: string, page: Pick<PageDetail, "id" | "permissions">): PageMenuItem[] {
  const canEdit = page.permissions.canEdit;
  const items: (PageMenuItem | null)[] = [
    { id: "attachments", label: "pageMenu.attachments", type: "dialog", dialog: "attachments" },
    { id: "history", label: "pageMenu.history", type: "link", href: pageHistoryHref(spaceKey, page.id) },
    { id: "restrictions", label: "pageMenu.restrictions", type: "inert" },
    { id: "peopleWhoCanView", label: "pageMenu.peopleWhoCanView", type: "inert" },
    { id: "info", label: "pageMenu.info", type: "dialog", dialog: "info" },
    { id: "hierarchy", label: "pageMenu.hierarchy", type: "link", href: hierarchyHref(spaceKey, page.id) },
    { id: "exportWord", label: "pageMenu.exportWord", type: "inert" },
    { id: "reqforge", label: "pageMenu.reqforge", type: "inert" },
    canEdit ? { id: "copy", label: "pageMenu.copy", type: "dialog", dialog: "copy" } : null,
    canEdit ? { id: "move", label: "pageMenu.move", type: "dialog", dialog: "move" } : null,
    canEdit ? { id: "delete", label: "pageMenu.delete", type: "dialog", dialog: "delete" } : null,
  ];
  return items.filter((item): item is PageMenuItem => item !== null);
}
