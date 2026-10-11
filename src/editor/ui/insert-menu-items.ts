// The `+ ▾` Insert More Content menu (10 §5.5), as data: every item in the drawn order, with its
// status. The component renders this table and nothing else, so the order and the statuses are
// tested here. `later` items are drawn disabled (RD-052 draws `later` the same way); Requirement
// is drawn disabled until slice 2 builds it (PLAN.md); the video's `Jira Issue/Filter` is the
// generic `External issue` (RD-031) and is `later` (integrations, phase 3).
// spec: docs/specs/10-ui-reference.md section 5.5 (Insert More Content menu)
import type { ParamlessCopyId } from "@/copy";
import { type MacroAvailability, type MacroId, macro } from "./macros";

export type InsertItemId =
  | "files"
  | "link"
  | "markup"
  | "horizontalRule"
  | "taskList"
  | "date"
  | "symbol"
  | "mention"
  | "externalIssue"
  | "info"
  | "status"
  | "gallery"
  | "toc"
  | "requirement"
  | "otherMacros";

export interface InsertItem {
  readonly id: InsertItemId;
  readonly label: ParamlessCopyId;
  readonly availability: MacroAvailability;
  /** The macro it inserts, for the items that are macros (shared with `{` and the browser). */
  readonly macro: MacroId | null;
  /** Drawn after a separator (`— Other macros`). */
  readonly separated: boolean;
}

function plain(id: InsertItemId, label: ParamlessCopyId): InsertItem {
  return { id, label, availability: "v1", macro: null, separated: false };
}

function macroItem(id: InsertItemId & MacroId): InsertItem {
  const m = macro(id);
  return { id, label: m.label, availability: m.availability, macro: id, separated: false };
}

/** Every item, in the order 10 §5.5 draws them. */
// spec: docs/specs/10-ui-reference.md section 5.5
export const INSERT_MENU: readonly InsertItem[] = Object.freeze([
  plain("files", "editor.files"),
  plain("link", "editor.link"),
  plain("markup", "editor.insert.markup"),
  plain("horizontalRule", "editor.insert.horizontalRule"),
  plain("taskList", "editor.taskList"),
  plain("date", "editor.insert.date"),
  plain("symbol", "editor.insert.symbol"),
  plain("mention", "editor.insert.mention"),
  macroItem("externalIssue"),
  macroItem("info"),
  macroItem("status"),
  macroItem("gallery"),
  macroItem("toc"),
  macroItem("requirement"),
  { id: "otherMacros", label: "insertMenu.otherMacros", availability: "v1", macro: null, separated: true },
] satisfies InsertItem[]);

export function isInsertItemAvailable(item: InsertItem): boolean {
  return item.availability === "v1";
}
