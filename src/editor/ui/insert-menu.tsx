"use client";

// The toolbar's `+ ▾` Insert More Content menu (10 §5.5): the items of INSERT_MENU in the drawn
// order, a menu button with arrow-key navigation (popover.tsx). Items that are not built yet are
// drawn and disabled (aria-disabled, titled `Not available yet`). Items that need input open a
// dialog through `actions`; the rest act on the editor at once, as one undo step.
// spec: docs/specs/10-ui-reference.md section 5.5 (Insert More Content menu); RD-031, RD-057
import type { Editor } from "@tiptap/core";
import { t } from "@/copy";
import { PlusIcon } from "./icons";
import { insertMacro } from "./insert-commands";
import { INSERT_MENU, type InsertItem, isInsertItemAvailable } from "./insert-menu-items";
import { MenuItem, Popover } from "./popover";
import type { EditorUiBridge } from "./ui-bridge";

export interface InsertMenuActions {
  readonly chooseFiles: () => void;
  readonly openLink: () => void;
  readonly openMarkup: () => void;
  readonly openDate: () => void;
  readonly openSymbol: () => void;
  readonly openMention: () => void;
  readonly openMacroBrowser: () => void;
}

export interface InsertMenuProps {
  readonly editor: Editor | null;
  readonly ui: EditorUiBridge;
  readonly disabled: boolean;
  readonly actions: InsertMenuActions;
}

/** What choosing an item does. */
// spec: docs/specs/10-ui-reference.md section 5.5
export function runInsertItem(item: InsertItem, editor: Editor, ui: EditorUiBridge, actions: InsertMenuActions): void {
  if (!isInsertItemAvailable(item) || !editor.isEditable) return;
  switch (item.id) {
    case "files":
      actions.chooseFiles();
      return;
    case "link":
      actions.openLink();
      return;
    case "markup":
      actions.openMarkup();
      return;
    case "horizontalRule":
      editor.chain().focus().setHorizontalRule().run();
      return;
    case "taskList":
      editor.chain().focus().toggleTaskList().run();
      return;
    case "date":
      actions.openDate();
      return;
    case "symbol":
      actions.openSymbol();
      return;
    case "mention":
      actions.openMention();
      return;
    case "otherMacros":
      actions.openMacroBrowser();
      return;
    default:
      if (item.macro) insertMacro(editor, item.macro, { ui });
  }
}

// spec: docs/specs/10-ui-reference.md section 5.5
export function InsertMenu({ editor, ui, disabled, actions }: InsertMenuProps) {
  const off = disabled || editor === null;
  return (
    <Popover
      kind="menu"
      label={t("editor.insertMore")}
      icon={<PlusIcon />}
      disabled={off}
      roving
      keepEditorFocus
      panelClassName="max-h-[70vh] overflow-y-auto"
      testId="insert-menu"
    >
      {INSERT_MENU.map((item) => {
        const available = isInsertItemAvailable(item);
        return (
          <div key={item.id} role="none" title={available ? undefined : t("shell.later")}>
            {item.separated ? <div role="separator" className="my-1 h-px bg-slate-200" /> : null}
            <MenuItem
              disabled={!available}
              onSelect={() => {
                if (editor) runInsertItem(item, editor, ui, actions);
              }}
            >
              {t(item.label)}
            </MenuItem>
          </div>
        );
      })}
    </Popover>
  );
}
