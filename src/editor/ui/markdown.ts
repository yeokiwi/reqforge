// The Markup dialog's conversion (10 §5.5: "paste Markdown or HTML and convert"). Markdown is
// converted with `marked` (GitHub-flavoured: tables, task lists, fenced code with a language),
// then the HTML goes through the same sanitiser as a paste, and is parsed by the schema's own
// parser, then cleaned like a pasted slice: a remote image is dropped (RD-058), an image of an
// attachment this page does not have is dropped, a refused link keeps its text, a code language
// the server refuses is cleared (RD-068), raw HTML in the Markdown gets no special pass.
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup); docs/specs/09-decision-log.md sections RD-058, RD-068
import type { Editor } from "@tiptap/core";
import { DOMParser as SchemaParser, type ResolvedPos, type Schema, Slice } from "@tiptap/pm/model";
import { Marked } from "marked";
import { type SliceCleanup, cleanPastedSlice, sanitizeHtml, stripUnstorable } from "./paste";

export type MarkupFormat = "markdown" | "html";

const markdown = new Marked({ gfm: true, breaks: false, async: false });

/** Markdown to sanitised HTML, ready for the schema's parser. */
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup: Markdown is converted)
export function markdownToHtml(source: string): string {
  const html = markdown.parse(stripUnstorable(source), { async: false });
  return sanitizeHtml(typeof html === "string" ? html : "", { taskLists: true });
}

/** The HTML the Markup dialog inserts for `source` written in `format`. */
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup: paste Markdown or HTML and convert)
export function markupToHtml(source: string, format: MarkupFormat): string {
  return format === "markdown" ? markdownToHtml(source) : sanitizeHtml(source);
}

/**
 * Sanitised HTML as a slice of the schema, parsed in an inert document (no script runs, no image
 * loads) and cleaned like a paste. Null where there is no DOM.
 */
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup); RD-058, RD-068
export function markupSlice(schema: Schema, html: string, cleanup: SliceCleanup, context?: ResolvedPos): Slice | null {
  if (typeof DOMParser === "undefined") return null;
  const dom = new DOMParser().parseFromString(sanitizeHtml(html), "text/html").body;
  const slice = SchemaParser.fromSchema(schema).parseSlice(dom, { preserveWhitespace: false, context });
  return cleanPastedSlice(slice, cleanup);
}

/** Whether a slice puts nothing on the page: no visible text and no atom but line breaks. */
export function isEmptySlice(slice: Slice): boolean {
  let empty = true;
  slice.content.descendants((node) => {
    if (!empty) return false;
    if (node.isText) {
      if ((node.text ?? "").trim().length > 0) empty = false;
    } else if (node.isLeaf && node.type.name !== "hardBreak") {
      empty = false;
    }
    return empty;
  });
  return empty;
}

/**
 * How converted markup goes in: one paragraph flows into the text at the caret (an open slice,
 * like a paste); anything else keeps its blocks whole (a closed slice), so `## Scope` stays a
 * heading instead of joining the caret's paragraph.
 */
export function markupInsertSlice(slice: Slice): Slice {
  const only = slice.content.childCount === 1 ? slice.content.firstChild : null;
  return only?.type.name === "paragraph" ? slice : new Slice(slice.content, 0, 0);
}

/**
 * Inserts converted markup at the selection, as ONE transaction (one undo step). Returns false,
 * changing nothing, when the markup yields nothing that can go on the page.
 */
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup)
export function insertMarkupHtml(editor: Editor, html: string, cleanup: SliceCleanup): boolean {
  if (!editor.isEditable) return false;
  const slice = markupSlice(editor.schema, html, cleanup, editor.state.selection.$from);
  if (!slice || isEmptySlice(slice)) return false;
  const insert = markupInsertSlice(slice);
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceSelection(insert);
      return true;
    })
    .scrollIntoView()
    .run();
}
