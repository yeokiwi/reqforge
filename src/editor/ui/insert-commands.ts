// What the `+ ▾` Insert More Content menu, the `{` Macro suggestions and the macro browser
// insert (10 §5.4–5.5), as transaction-level functions that compose into ONE TipTap chain, so the
// `{query` text is deleted and the macro inserted in a single undo step. Every node is built with
// the shared schema and checked against its value rules before it goes in (RD-063, RD-068): an
// invalid date, an empty status, a mention without a well-formed user id are refused here rather
// than stored and refused by the server on the next autosave.
//
// Where an inline node cannot go (a status in a code block), it goes in a new paragraph after the
// block instead of splitting it; a block (the table of contents) goes where ProseMirror's own
// `replaceSelectionWith` puts it.
// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5; docs/specs/03-authoring-and-indexing.md section 1.4 (RD-058, RD-063, RD-068)
import type { Editor, Range } from "@tiptap/core";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { findWrapping } from "@tiptap/pm/transform";
import type { AttachmentRef, UserRef } from "@/domain/documents/api-types";
import { t } from "@/copy";
import {
  ATTACHMENT_PATH_PREFIX,
  STATUS_COLOURS,
  type StatusColour,
  isAllowedHref,
  isAttachmentSrcFor,
  isCalendarDate,
  isStatusText,
} from "@/editor/schema";
import { normaliseStatusText } from "@/editor/schema/nodes";
import { isEntityId } from "@/editor/schema/rules";
import { type MacroId, browserStorage, isMacroAvailable, recordRecentMacro } from "./macros";
import { stripUnstorable } from "./paste";
import type { EditorUiBridge } from "./ui-bridge";

/** The longest mention label the schema stores (UTF-16 code units, as the validator counts). */
export const MENTION_LABEL_MAX = 255;

// ---------------------------------------------------------------------------- placement

/** Depth of the textblock holding `pos`, or null when `pos` is between blocks. */
function textblockDepth(tr: Transaction, pos: number): number | null {
  const $pos = tr.doc.resolve(pos);
  return $pos.parent.isTextblock ? $pos.depth : null;
}

/**
 * Inserts an inline node at the selection, or — where the selection's block cannot hold it (a
 * code block) — in a new paragraph right after that block. Returns the node's position, or null
 * when it could not be placed.
 */
export function insertInlineNode(tr: Transaction, node: PMNode): number | null {
  const { $from, $to } = tr.selection;
  const parent = $from.parent;
  if (parent.isTextblock && $from.sameParent($to) && parent.canReplaceWith($from.index(), $to.index(), node.type)) {
    const from = $from.pos;
    tr.replaceWith(from, $to.pos, node);
    tr.setSelection(TextSelection.create(tr.doc, from + node.nodeSize));
    return from;
  }
  const depth = textblockDepth(tr, $from.pos);
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (depth === null || !paragraph) return null;
  const after = $from.after(depth);
  const $after = tr.doc.resolve(after);
  if (!$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return null;
  tr.insert(after, paragraph.create(null, node));
  tr.setSelection(TextSelection.create(tr.doc, after + 1 + node.nodeSize));
  return after + 1;
}

/** Inserts a block node where ProseMirror places one at the selection; false if it found no place. */
export function insertBlockNode(tr: Transaction, node: PMNode): boolean {
  const before = tr.doc;
  tr.replaceSelectionWith(node, false);
  return tr.doc !== before;
}

// ------------------------------------------------------------------------------ the items

/**
 * `Info` (10 §5.4–5.5): with a range selected, wraps the selected blocks in an info panel; with
 * the caret in an empty paragraph, makes that paragraph the panel's first; otherwise inserts an
 * empty panel after the block holding the caret. The caret ends inside the panel.
 */
// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Info — info panel); RD-057
export function insertInfoPanel(tr: Transaction): boolean {
  const schema = tr.doc.type.schema;
  const panel = schema.nodes.infoPanel;
  const paragraph = schema.nodes.paragraph;
  if (!panel || !paragraph) return false;
  const { $from, $to, empty } = tr.selection;
  const wrap = (): boolean => {
    const range = $from.blockRange($to);
    const wrapping = range ? findWrapping(range, panel, { variant: "info" }) : null;
    if (!range || !wrapping) return false;
    tr.wrap(range, wrapping);
    return true;
  };
  const emptyParagraph = $from.parent.type === paragraph && $from.parent.content.size === 0;
  if ((!empty || emptyParagraph) && !(tr.selection instanceof NodeSelection) && wrap()) return true;
  const depth = textblockDepth(tr, $from.pos);
  const at = depth === null ? $from.pos : $from.after(depth);
  const $at = tr.doc.resolve(at);
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), panel)) return wrap();
  tr.insert(at, panel.create({ variant: "info" }, paragraph.create()));
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  return true;
}

/** `Status`: a lozenge with the default text, grey. Returns its position (to open its editor). */
// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Status — lozenge)
export function insertStatus(tr: Transaction): number | null {
  const type = tr.doc.type.schema.nodes.status;
  if (!type) return null;
  return insertInlineNode(tr, type.create({ text: t("editor.status.defaultText"), colour: "grey" }));
}

/** `Table of Contents`: the block that lists the page's headings. */
// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Table of Contents)
export function insertTableOfContents(tr: Transaction): boolean {
  const type = tr.doc.type.schema.nodes.tableOfContents;
  return type ? insertBlockNode(tr, type.create()) : false;
}

/** `Date`: a date node, `YYYY-MM-DD`. Refuses a value that is not a real date (RD-068). */
// spec: docs/specs/10-ui-reference.md section 5.5 (Date); RD-068 (a real date)
export function insertDate(tr: Transaction, value: string): number | null {
  const type = tr.doc.type.schema.nodes.date;
  if (!type || !isCalendarDate(value)) return null;
  return insertInlineNode(tr, type.create({ value }));
}

/** A label the schema stores: at most 255 UTF-16 units, never cutting a character in half. */
export function mentionLabel(name: string): string | null {
  let label = "";
  for (const ch of stripUnstorable(name)) {
    if (label.length + ch.length > MENTION_LABEL_MAX) break;
    label += ch;
  }
  return label.trim().length > 0 ? label : null;
}

/** `User mention`: an atom keyed by the user id, showing their name. */
// spec: docs/specs/10-ui-reference.md section 5.5 (User mention); RD-068 (userId, label 1–255)
export function insertMention(tr: Transaction, user: UserRef): number | null {
  const type = tr.doc.type.schema.nodes.mention;
  const label = mentionLabel(user.name);
  if (!type || !isEntityId(user.id) || label === null) return null;
  return insertInlineNode(tr, type.create({ userId: user.id, label }));
}

/** `Symbol`: the character, as text with the marks at the caret. */
// spec: docs/specs/10-ui-reference.md section 5.5 (Symbol)
export function insertText(tr: Transaction, text: string): boolean {
  const clean = stripUnstorable(text);
  if (clean.length === 0) return false;
  tr.insertText(clean);
  return true;
}

// -------------------------------------------------------------------------- attachments

/** The `src` an image of this attachment gets: the server's URL when it is well formed. */
export function attachmentSrc(ref: Pick<AttachmentRef, "id" | "filename" | "url">): string | null {
  if (isAttachmentSrcFor(ref.url, ref.id)) return ref.url;
  const built = `${ATTACHMENT_PATH_PREFIX}${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.filename)}`;
  return isAttachmentSrcFor(built, ref.id) ? built : null;
}

/**
 * The node an uploaded attachment becomes (RD-058): an image of a verified image, or a link to a
 * file, its text the file name. Null when the server's answer cannot make a valid node.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (images inline; other files download)
export function attachmentContent(tr: Transaction, ref: AttachmentRef): PMNode | null {
  const schema = tr.doc.type.schema;
  const src = attachmentSrc(ref);
  if (src === null) return null;
  if (ref.image) {
    return schema.nodes.image?.create({ attachmentId: ref.id, src, alt: ref.filename }) ?? null;
  }
  const link = schema.marks.link;
  const text = stripUnstorable(ref.filename);
  if (!link || text.length === 0 || !isAllowedHref(src)) return null;
  return schema.text(text, [link.create({ href: src })]);
}

/**
 * Inserts an uploaded attachment at `pos` (where its upload placeholder now is). A link cannot
 * carry its mark inside a code block, and an image cannot sit there, so there it goes in a new
 * paragraph after the block. Returns false when nothing could be inserted.
 */
// spec: docs/specs/09-decision-log.md section RD-058
export function insertAttachmentAt(tr: Transaction, pos: number, ref: AttachmentRef): boolean {
  const node = attachmentContent(tr, ref);
  if (!node) return false;
  const $pos = tr.doc.resolve(Math.max(0, Math.min(pos, tr.doc.content.size)));
  const fits =
    $pos.parent.isTextblock &&
    $pos.parent.canReplaceWith($pos.index(), $pos.index(), node.type, node.marks) &&
    (node.isText ? $pos.parent.type.allowsMarks(node.marks) : true);
  if (fits) {
    tr.insert($pos.pos, node);
    return true;
  }
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (!paragraph) return false;
  const at = $pos.parent.isTextblock ? $pos.after() : $pos.pos;
  const $at = tr.doc.resolve(at);
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), paragraph)) return false;
  tr.insert(at, paragraph.create(null, node));
  return true;
}

// ------------------------------------------------------------------------- node editing

/** The position of `node` (by identity) in `doc`, or null. Survives edits made around it. */
export function findNodePos(doc: PMNode, node: PMNode): number | null {
  let found: number | null = null;
  doc.descendants((child, pos) => {
    if (found !== null) return false;
    if (child === node) {
      found = pos;
      return false;
    }
    return !child.isLeaf;
  });
  return found;
}

/** Sets a status lozenge's text and colour. Refuses text the schema refuses (RD-068). */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (status: text 1–60 characters, one line; colour)
export function updateStatus(tr: Transaction, pos: number, input: { text: string; colour: StatusColour }): boolean {
  const node = tr.doc.nodeAt(pos);
  const text = normaliseStatusText(stripUnstorable(input.text));
  if (node?.type.name !== "status" || !isStatusText(text) || !STATUS_COLOURS.includes(input.colour)) return false;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, text, colour: input.colour });
  return true;
}

/** Sets a date node's value. Refuses a value that is not a real date (RD-068). */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (date: YYYY-MM-DD, a real date)
export function updateDate(tr: Transaction, pos: number, value: string): boolean {
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name !== "date" || !isCalendarDate(value)) return false;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, value });
  return true;
}

/** Today, in the user's own time zone, as `YYYY-MM-DD` (the Date dialog's starting value). */
export function todayValue(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ------------------------------------------------------------------------------- macros

export interface InsertMacroOptions {
  /** The `{query` text to delete in the same transaction. */
  readonly range?: Range;
  readonly ui: EditorUiBridge;
}

/**
 * Inserts an available macro (Info, Status, Table of Contents) as ONE transaction, deleting the
 * `{query` text first when it came from Macro suggestions; Status then opens its editor. Records
 * the macro as recently used (10 §5.4). Unavailable macros (Gallery, Requirement, …) do nothing.
 */
// spec: docs/specs/10-ui-reference.md sections 5.4 (`{` Macro suggestions) and 5.5 (Insert More Content menu)
export function insertMacro(editor: Editor, id: MacroId, { range, ui }: InsertMacroOptions): boolean {
  if (!isMacroAvailable(id) || !editor.isEditable) return false;
  let statusPos: number | null = null;
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  const ok = chain
    .command(({ tr }) => {
      switch (id) {
        case "info":
          return insertInfoPanel(tr);
        case "toc":
          return insertTableOfContents(tr);
        case "status":
          statusPos = insertStatus(tr);
          return statusPos !== null;
        default:
          return false;
      }
    })
    .scrollIntoView()
    .run();
  if (!ok) return false;
  recordRecentMacro(browserStorage(), id);
  ui.call("macroInserted", id);
  if (statusPos !== null) ui.call("editNode", { kind: "status", pos: statusPos });
  return true;
}

/** Runs one transaction-level insert as a focused chain (one undo step). */
export function runInsert<T>(editor: Editor, insert: (tr: Transaction) => T, ok: (result: T) => boolean = Boolean): T | null {
  if (!editor.isEditable) return null;
  let result: T | null = null;
  const done = editor
    .chain()
    .focus()
    .command(({ tr }) => {
      result = insert(tr);
      return ok(result);
    })
    .scrollIntoView()
    .run();
  return done ? result : null;
}

/** Whether a NodeType name is one of the inline atoms the node editors handle. */
export function isEditableAtom(type: NodeType | undefined): type is NodeType {
  return type?.name === "status" || type?.name === "date";
}
