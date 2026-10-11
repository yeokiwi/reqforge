// What the toolbar buttons do, as functions over a TipTap editor. Each command runs as ONE
// transaction (one undo step) and refocuses the editor. The toolbar state (what is pressed,
// what is enabled) is computed here too, by toolbarState(), so the React components only
// render it. Nothing here adds schema: every node, mark and attribute used is the shared
// schema's (03 section 1.4).
// spec: docs/specs/10-ui-reference.md section 5.1 (toolbar rows 1 and 2); docs/specs/09-decision-log.md section RD-057
import { type Editor, getMarkRange } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { sinkListItem } from "@tiptap/pm/schema-list";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TableMap, cellAround, columnIsHeader, findTable, rowIsHeader } from "@tiptap/pm/tables";
import { INDENT_MAX, TABLE_WIDTH_MODES, isAllowedHref, type TableWidthMode, type TextAlignment } from "@/editor/schema";
import { exceedsDepth } from "./depth";

// ------------------------------------------------------------------------- paragraph style

/** The `Paragraph ▾` items (10 section 5.1): Normal, Heading 1 to 6, Quote, Preformatted. */
export const BLOCK_STYLES = ["normal", "h1", "h2", "h3", "h4", "h5", "h6", "quote", "preformatted"] as const;
export type BlockStyle = (typeof BLOCK_STYLES)[number];

export function headingLevelOf(style: BlockStyle): 1 | 2 | 3 | 4 | 5 | 6 | null {
  switch (style) {
    case "h1":
      return 1;
    case "h2":
      return 2;
    case "h3":
      return 3;
    case "h4":
      return 4;
    case "h5":
      return 5;
    case "h6":
      return 6;
    default:
      return null;
  }
}

function hasAncestor($pos: ResolvedPos, name: string): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === name) return true;
  }
  return false;
}

/** The style of the block holding the caret: the textblock's own type first, then a quote around it. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`Paragraph ▾`)
export function currentBlockStyle(editor: Editor): BlockStyle {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  if (parent.type.name === "codeBlock") return "preformatted";
  if (parent.type.name === "heading") {
    const style = BLOCK_STYLES.find((s) => headingLevelOf(s) === parent.attrs.level);
    if (style) return style;
  }
  if (hasAncestor($from, "blockquote")) return "quote";
  return "normal";
}

/** Applies a `Paragraph ▾` item. A no-op when the block already has that style. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`Paragraph ▾` = Normal, H1–H6, Quote, Preformatted)
export function setBlockStyle(editor: Editor, style: BlockStyle): boolean {
  const { $from } = editor.state.selection;
  const textblock = $from.parent.type.name;
  const inQuote = hasAncestor($from, "blockquote");
  const level = headingLevelOf(style);
  if (level !== null) {
    if (textblock === "heading" && $from.parent.attrs.level === level) return false;
    return editor.chain().focus().setHeading({ level }).run();
  }
  switch (style) {
    case "normal": {
      if (textblock === "paragraph" && !inQuote) return false;
      // setParagraph on a paragraph would fall back to clearing its lists: only convert what needs it.
      let chain = editor.chain().focus();
      if (textblock !== "paragraph") chain = chain.setParagraph();
      if (inQuote) chain = chain.lift("blockquote");
      return chain.run();
    }
    case "quote":
      if (inQuote) return false;
      return editor.chain().focus().wrapIn("blockquote").run();
    case "preformatted":
      if (textblock === "codeBlock") return false;
      return editor.chain().focus().setCodeBlock().run();
    default:
      return false;
  }
}

// --------------------------------------------------------------------------------- indent

function innermostListItem($pos: ResolvedPos): "listItem" | "taskItem" | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = $pos.node(depth).type.name;
    if (name === "listItem" || name === "taskItem") return name;
  }
  return null;
}

function indentOf(node: PMNode): number {
  const indent: unknown = node.attrs.indent;
  return typeof indent === "number" ? indent : 0;
}

/** Paragraphs and headings in the selection, outside list items (those are sunk and lifted). */
function indentableBlocks(doc: PMNode, from: number, to: number): Array<{ node: PMNode; pos: number }> {
  const blocks: Array<{ node: PMNode; pos: number }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      blocks.push({ node, pos });
      return false;
    }
    return true;
  });
  return blocks;
}

/**
 * Whether the list item at the selection can be sunk: the list command allows it, and the
 * result is no deeper than RD-063's 64 (each level adds a list and an item).
 */
// spec: docs/specs/09-decision-log.md sections RD-057 (`⇥` sinks a list item) and RD-063 (nesting depth at most 64)
function canSink(state: EditorState, item: "listItem" | "taskItem"): boolean {
  const type = state.schema.nodes[item];
  if (!type) return false;
  const made: { tr: Transaction | null } = { tr: null };
  sinkListItem(type)(state, (tr) => {
    made.tr = tr;
  });
  return made.tr !== null && !exceedsDepth(made.tr);
}

/**
 * `⇤` `⇥`: in a list item, lift or sink the item (never past RD-063's depth); elsewhere change
 * the `indent` attribute of every selected paragraph and heading by one step, within 0–6.
 */
// spec: docs/specs/09-decision-log.md section RD-057 (`⇤ ⇥`: lists lift/sink; paragraphs and headings change indent level 0–6); RD-063
export function shiftIndent(editor: Editor, delta: 1 | -1): boolean {
  const item = innermostListItem(editor.state.selection.$from);
  if (item) {
    if (delta > 0) return canSink(editor.state, item) && editor.chain().focus().sinkListItem(item).run();
    return editor.chain().focus().liftListItem(item).run();
  }
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      let changed = false;
      for (const { node, pos } of indentableBlocks(tr.doc, tr.selection.from, tr.selection.to)) {
        const current = indentOf(node);
        const next = Math.min(INDENT_MAX, Math.max(0, current + delta));
        if (next !== current) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
          changed = true;
        }
      }
      return changed;
    })
    .run();
}

/** Whether `⇥` (delta 1) or `⇤` (delta -1) would change anything. */
export function canShiftIndent(editor: Editor, delta: 1 | -1): boolean {
  const { selection, doc } = editor.state;
  const item = innermostListItem(selection.$from);
  if (item) return delta > 0 ? canSink(editor.state, item) : editor.can().liftListItem(item);
  return indentableBlocks(doc, selection.from, selection.to).some(({ node }) => {
    const indent = indentOf(node);
    return delta > 0 ? indent < INDENT_MAX : indent > 0;
  });
}

// ------------------------------------------------------------------------------ alignment

/** The textblock's alignment, or null for the default. */
export function currentAlignment(editor: Editor): TextAlignment | null {
  const parent = editor.state.selection.$from.parent;
  const align: unknown = parent.attrs.textAlign;
  return align === "left" || align === "center" || align === "right" || align === "justify" ? align : null;
}

/**
 * `⫷ ⫸ ⫶` (RD-057: left, right, centre). Left is the default and is stored as null, so a
 * stored document stays canonical; pressing an active right or centre returns to the default.
 */
// spec: docs/specs/09-decision-log.md section RD-057 (`⫷ ⫸ ⫶`)
export function setAlignment(editor: Editor, align: "left" | "right" | "center"): boolean {
  const current = currentAlignment(editor);
  if (align === "left" || current === align) return editor.chain().focus().unsetTextAlign().run();
  return editor.chain().focus().setTextAlign(align).run();
}

// ----------------------------------------------------------------------------- formatting

/** The `textStyle` colour at the selection, or null for the default. */
export function currentTextColour(editor: Editor): string | null {
  const colour: unknown = editor.getAttributes("textStyle").color;
  return typeof colour === "string" ? colour.toLowerCase() : null;
}

/** `A▾`: a palette colour, or null for the default colour. */
// spec: docs/specs/09-decision-log.md section RD-057 (`A▾` text colour)
export function setTextColour(editor: Editor, hex: string | null): boolean {
  return hex === null ? editor.chain().focus().unsetColor().run() : editor.chain().focus().setColor(hex).run();
}

/** Marks `Clear formatting` removes: every text format, but not links (a link is content). */
export const FORMATTING_MARKS = ["bold", "italic", "underline", "strike", "code", "subscript", "superscript", "textStyle"] as const;

// spec: docs/specs/09-decision-log.md section RD-057 (`Aᵃ▾` … clear formatting)
export function clearFormatting(editor: Editor): boolean {
  let chain = editor.chain().focus();
  for (const mark of FORMATTING_MARKS) chain = chain.unsetMark(mark);
  return chain.run();
}

/** `▭`: wrap the selected blocks in an info panel, or lift them out of the one they are in. */
// spec: docs/specs/09-decision-log.md section RD-057 (`▭` info panel)
export function toggleInfoPanel(editor: Editor): boolean {
  if (editor.isActive("infoPanel")) return editor.chain().focus().lift("infoPanel").run();
  return editor.chain().focus().wrapIn("infoPanel", { variant: "info" }).run();
}

/** `☺`: the emoji goes in as plain Unicode text. */
// spec: docs/specs/09-decision-log.md section RD-057 (`☺` emoji)
export function insertEmoji(editor: Editor, emoji: string): boolean {
  return editor.chain().focus().insertContent({ type: "text", text: emoji }).run();
}

/** `▦▾`: a table of the chosen size, with a header row (the shape requirement tables take). */
// spec: docs/specs/09-decision-log.md section RD-057 (`▦▾` table with a size grid)
export function insertTable(editor: Editor, rows: number, cols: number): boolean {
  return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
}

// ---------------------------------------------------------------------------------- links

export interface LinkTarget {
  readonly from: number;
  readonly to: number;
  /** The href of the link being edited, or null when inserting. */
  readonly href: string | null;
  /** The text the link would cover: the selection, or the whole existing link. */
  readonly text: string;
}

/** What the link dialog acts on: an existing link around the caret, else the selection. */
export function linkTarget(editor: Editor): LinkTarget {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const linkType = state.schema.marks.link;
  if (linkType && editor.isActive("link")) {
    const href: unknown = editor.getAttributes("link").href;
    // With a bare caret, act on the whole link it sits in.
    const range = empty ? getMarkRange(state.doc.resolve(from), linkType) : undefined;
    const start = range ? range.from : from;
    const end = range ? range.to : to;
    return { from: start, to: end, href: typeof href === "string" ? href : null, text: state.doc.textBetween(start, end, " ") };
  }
  return { from, to, href: null, text: state.doc.textBetween(from, to, " ") };
}

/**
 * Applies the link dialog. With `text`, the target range is replaced by that text, linked;
 * without it, the target range is linked, or the address itself is inserted as the text.
 * Refuses (returns false, changes nothing) an href the schema's link rule refuses.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (link.href rule, RD-063, RD-068)
export function applyLink(editor: Editor, input: { href: string; text: string }): boolean {
  const href = input.href.trim();
  if (!isAllowedHref(href)) return false;
  const target = linkTarget(editor);
  const text = input.text.length > 0 ? input.text : target.from === target.to ? href : null;
  const chain = editor.chain().focus();
  if (text === null) {
    return chain.setTextSelection({ from: target.from, to: target.to }).setLink({ href }).run();
  }
  return chain
    .insertContentAt({ from: target.from, to: target.to }, { type: "text", text, marks: [{ type: "link", attrs: { href } }] })
    .unsetMark("link")
    .run();
}

export function removeLink(editor: Editor): boolean {
  const target = linkTarget(editor);
  return editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).unsetLink().run();
}

// --------------------------------------------------------------------------------- tables

function activeTable(editor: Editor): { node: PMNode; pos: number } | null {
  const found = findTable(editor.state.selection.$from);
  return found ? { node: found.node, pos: found.pos } : null;
}

/** Sets attributes on the table holding the selection, as one transaction. */
function setTableAttrs(editor: Editor, attrs: Record<string, unknown>): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const found = findTable(tr.selection.$from);
      if (!found) return false;
      tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...attrs });
      return true;
    })
    .run();
}

/** `Responsive ▾` / `Fixed width ▾`: the table's `widthMode`. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`Responsive ▾` / `Fixed width ▾`); RD-057
export function setTableWidthMode(editor: Editor, mode: TableWidthMode): boolean {
  if (!TABLE_WIDTH_MODES.includes(mode)) return false;
  return setTableAttrs(editor, { widthMode: mode });
}

/** `num`: the table's `numberedColumn` (a CSS counter; nothing is stored per row). */
// spec: docs/specs/09-decision-log.md section RD-057 (`num`), RD-069
export function toggleNumberedColumn(editor: Editor): boolean {
  const table = activeTable(editor);
  if (!table) return false;
  return setTableAttrs(editor, { numberedColumn: table.node.attrs.numberedColumn !== true });
}

/** `fill ▾`: the selected cells' `background`, or null for no fill. */
// spec: docs/specs/09-decision-log.md section RD-057 (`fill ▾` sets the cell background)
export function setCellBackground(editor: Editor, hex: string | null): boolean {
  return editor.chain().focus().setCellAttribute("background", hex).run();
}

export interface TableToolbarState {
  readonly widthMode: TableWidthMode;
  readonly numbered: boolean;
  readonly headerRow: boolean;
  readonly headerColumn: boolean;
  /** The background of the cell holding the caret. */
  readonly background: string | null;
  readonly can: {
    readonly addRowBefore: boolean;
    readonly addRowAfter: boolean;
    readonly deleteRow: boolean;
    readonly addColumnBefore: boolean;
    readonly addColumnAfter: boolean;
    readonly deleteColumn: boolean;
    readonly mergeCells: boolean;
    readonly splitCell: boolean;
    readonly toggleHeaderRow: boolean;
    readonly toggleHeaderColumn: boolean;
    readonly deleteTable: boolean;
  };
}

/** The table row-2 state, or null when the selection is not inside a table. */
// spec: docs/specs/10-ui-reference.md section 5.1 (row 2 appears only while the caret is in a table)
export function tableToolbarState(editor: Editor): TableToolbarState | null {
  const table = activeTable(editor);
  if (!table) return null;
  const { node } = table;
  const map = TableMap.get(node);
  const mode: unknown = node.attrs.widthMode;
  const $cell = cellAround(editor.state.selection.$from);
  const background: unknown = $cell?.nodeAfter?.attrs.background;
  const can = editor.can();
  return {
    widthMode: mode === "fixed" ? "fixed" : "responsive",
    numbered: node.attrs.numberedColumn === true,
    headerRow: map.height > 0 && rowIsHeader(map, node, 0),
    headerColumn: map.width > 0 && columnIsHeader(map, node, 0),
    background: typeof background === "string" ? background : null,
    can: {
      addRowBefore: can.addRowBefore(),
      addRowAfter: can.addRowAfter(),
      deleteRow: can.deleteRow(),
      addColumnBefore: can.addColumnBefore(),
      addColumnAfter: can.addColumnAfter(),
      deleteColumn: can.deleteColumn(),
      mergeCells: can.mergeCells(),
      splitCell: can.splitCell(),
      toggleHeaderRow: can.toggleHeaderRow(),
      toggleHeaderColumn: can.toggleHeaderColumn(),
      deleteTable: can.deleteTable(),
    },
  };
}

// ------------------------------------------------------------------------- toolbar state

export interface ToolbarState {
  readonly blockStyle: BlockStyle;
  readonly marks: {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strike: boolean;
    readonly subscript: boolean;
    readonly superscript: boolean;
    readonly code: boolean;
  };
  readonly textColour: string | null;
  readonly lists: { readonly bulletList: boolean; readonly orderedList: boolean; readonly taskList: boolean };
  readonly canIndent: boolean;
  readonly canOutdent: boolean;
  readonly align: TextAlignment | null;
  readonly infoPanel: boolean;
  readonly link: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Row 2's state, or null outside a table. */
  readonly table: TableToolbarState | null;
}

/** Everything the two toolbar rows show, computed from the editor's current state. */
// spec: docs/specs/10-ui-reference.md section 5.1; docs/specs/09-decision-log.md section RD-057
export function toolbarState(editor: Editor): ToolbarState {
  return {
    blockStyle: currentBlockStyle(editor),
    marks: {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      subscript: editor.isActive("subscript"),
      superscript: editor.isActive("superscript"),
      code: editor.isActive("code"),
    },
    textColour: currentTextColour(editor),
    lists: {
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      taskList: editor.isActive("taskList"),
    },
    canIndent: canShiftIndent(editor, 1),
    canOutdent: canShiftIndent(editor, -1),
    align: currentAlignment(editor),
    infoPanel: editor.isActive("infoPanel"),
    link: editor.isActive("link"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    table: tableToolbarState(editor),
  };
}
