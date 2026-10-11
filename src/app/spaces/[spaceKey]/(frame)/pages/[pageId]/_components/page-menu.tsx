"use client";

// The page view's `···` menu (10 section 4.1), on the shared menu primitive (keyboard: arrows,
// Home/End, Escape returns focus to the trigger; inert items are skipped). Items, in the video's
// order (RD-059):
//
//   Attachments · Page History · Restrictions · People who can view · Page information ·
//   View in Hierarchy · Export to Word · Reqforge · Copy · Move · Delete
//
// Page History and View in Hierarchy are links. Attachments, Page information, Copy, Move and
// Delete open a dialog: they call `onOpenDialog(kind)`, the parent holds the state and renders
// <PageDialogs>. Restrictions, People who can view, Export to Word and Reqforge are drawn inert
// with "Not available yet". Copy, Move and Delete are present only with space EDIT (07 §2.4).
// spec: docs/specs/10-ui-reference.md section 4.1 (`···`); docs/specs/09-decision-log.md section RD-059
import { useState } from "react";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents";
import { Dots } from "@/ui/icons";
import { Menu, MenuItemDisabled, MenuLink, menuItemButtonClass } from "@/ui/menu";
import { pageMenuItems } from "../_lib/menu-items";
import type { PageDialogKind } from "./page-dialogs";

export interface PageMenuProps {
  /** The canonical space key (URLs are built from it). */
  readonly spaceKey: string;
  /** The page as the viewer sees it; `permissions.canEdit` decides Copy, Move and Delete. */
  readonly page: PageDetail;
  /** Called by the dialog items; the menu has already closed itself. */
  readonly onOpenDialog: (kind: PageDialogKind) => void;
}

const triggerClass =
  "inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 aria-expanded:bg-slate-100";

// spec: docs/specs/09-decision-log.md section RD-059 (the `···` menu: what ships and what holds a slot)
export function PageMenu({ spaceKey, page, onOpenDialog }: PageMenuProps) {
  // The shared Menu closes itself for links, Escape, Tab and outside clicks; a button item has no
  // way to close it, so a dialog item remounts it (a new key), which closes it.
  const [generation, setGeneration] = useState(0);
  const items = pageMenuItems(spaceKey, page);

  return (
    <Menu
      key={generation}
      label={t("pageMenu.label")}
      trigger={<Dots />}
      placement="bottom-end"
      triggerClassName={triggerClass}
      testId="page-menu"
    >
      {items.map((item) => {
        switch (item.type) {
          case "link":
            return (
              <MenuLink key={item.id} href={item.href}>
                {t(item.label)}
              </MenuLink>
            );
          case "inert":
            return (
              <MenuItemDisabled key={item.id} title={t("shell.later")}>
                {t(item.label)}
              </MenuItemDisabled>
            );
          case "dialog":
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={menuItemButtonClass}
                onClick={() => {
                  setGeneration((g) => g + 1);
                  onOpenDialog(item.dialog);
                }}
              >
                {t(item.label)}
              </button>
            );
        }
      })}
    </Menu>
  );
}
