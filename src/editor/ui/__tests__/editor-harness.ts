// Shared jsdom helpers for tests that run a real TipTap editor with the editor UI's extension
// list. Not a test file. jsdom has no layout, so ProseMirror's scroll-into-view (which a
// `.focus()` in a command chain triggers) needs the measuring APIs stubbed to report nothing.
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach } from "vitest";
import { buildEditorExtensions } from "../extensions";

/** Stubs the layout APIs ProseMirror measures with; jsdom implements none of them. */
export function stubLayout(): void {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  const rects = () => Object.assign([rect], { item: () => rect }) as unknown as DOMRectList;
  if (typeof Range !== "undefined") {
    Range.prototype.getClientRects = rects;
    Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  }
  if (typeof Element !== "undefined") {
    Element.prototype.getClientRects = rects;
    Element.prototype.scrollIntoView = () => undefined;
  }
  if (typeof document !== "undefined" && !document.elementFromPoint) {
    document.elementFromPoint = () => null;
  }
}

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** An editor with the UI's extensions, attached to the document so focus works. */
export function newEditor(content?: JSONContent): Editor {
  stubLayout();
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: buildEditorExtensions({ placeholder: "Type here" }), content: content ?? null });
  editors.push(editor);
  return editor;
}

export const p = (...content: JSONContent[]): JSONContent => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
export const text = (value: string, marks?: JSONContent["marks"]): JSONContent => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
export const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

/** A 2×2 table with a header row, optionally with attributes and first-row widths. */
export function table(attrs: Record<string, unknown> = {}, widths: (number | null)[] = [null, null]): JSONContent {
  const cell = (type: "tableHeader" | "tableCell", value: string, width: number | null) => ({
    type,
    attrs: width === null ? {} : { colwidth: [width] },
    content: [p(text(value))],
  });
  return {
    type: "table",
    attrs,
    content: [
      { type: "tableRow", content: [cell("tableHeader", "H1", widths[0] ?? null), cell("tableHeader", "H2", widths[1] ?? null)] },
      { type: "tableRow", content: [cell("tableCell", "A", null), cell("tableCell", "B", null)] },
    ],
  };
}

/** The document position just inside the first text that equals `value`. */
export function posOf(editor: Editor, value: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === value) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`no text "${value}"`);
  return found;
}

/** Selects the text `value` (or puts the caret at its start). */
export function select(editor: Editor, value: string, caret = false): void {
  const from = posOf(editor, value);
  editor.commands.setTextSelection(caret ? from : { from, to: from + value.length });
}
