// @vitest-environment jsdom
// RD-063 caps nesting at 64 nodes (`doc` is 1, text counts) and the server refuses anything
// deeper; from then on every autosave is a 422 that points at nothing. So no editor path may
// build such a document: the Markup dialog, a paste, ⇥ on a list item, and (through the
// backstop) anything else — wrapping, Tab in a list, a table in a table cell. Each test ends
// where it matters: the document still validates against the server's schema.
import type { Editor, JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { MAX_NODE_DEPTH, validateDocumentJson } from "@/editor/schema";
import { canShiftIndent, shiftIndent, toolbarState } from "../commands";
import { insertMarkupHtml, markdownToHtml, markupToHtml } from "../markdown";
import { doc, newEditor, p, posOf, select, text } from "./editor-harness";

const keepNone = { keepImage: () => false };

function expectStorable(editor: Editor): void {
  const result = validateDocumentJson(editor.getJSON());
  expect(result.ok, JSON.stringify(!result.ok && result)).toBe(true);
}

/** The validator's depth of the deepest node (`doc` is 1, text counts). */
function depthOf(json: JSONContent): number {
  return 1 + Math.max(0, ...(json.content ?? []).map(depthOf));
}

function countType(editor: Editor, name: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) n += 1;
  });
  return n;
}

function pasteEvent(): ClipboardEvent {
  return { clipboardData: null, preventDefault: () => undefined } as unknown as ClipboardEvent;
}

/** `levels` blockquotes around one paragraph of `value`. */
function quotes(levels: number, value: string): JSONContent {
  let node: JSONContent = p(text(value));
  for (let i = 0; i < levels; i++) node = { type: "blockquote", content: [node] };
  return node;
}

/**
 * A bullet list nested `extra` times inside its first item; the innermost list holds the items
 * `a` and `b`. The text of `b` sits at depth 5 + 2 × extra; sinking `b` adds 2.
 */
function nestedList(extra: number): JSONContent {
  const item = (value: string, ...more: JSONContent[]): JSONContent => ({ type: "listItem", content: [p(text(value)), ...more] });
  let list: JSONContent = { type: "bulletList", content: [item("a"), item("b")] };
  for (let i = 0; i < extra; i++) list = { type: "bulletList", content: [item(`level ${extra - i}`, list)] };
  return doc(list);
}

describe("the Markup dialog (RD-063)", () => {
  it("70 nested quotes of Markdown go in flattened: the text is kept and the page still saves", () => {
    const editor = newEditor(doc(p()));
    const ok = insertMarkupHtml(editor, markdownToHtml(`${"> ".repeat(70)}deep`), keepNone);
    expect(ok).toBe(true);
    expect(editor.getText()).toContain("deep");
    expectStorable(editor);
  });

  it("the same for HTML, and the text before and after the deep part keeps its place", () => {
    const editor = newEditor(doc(p()));
    const html = `<h2>Title</h2>${"<blockquote>".repeat(70)}<p><strong>deep</strong></p>${"</blockquote>".repeat(70)}<p>after</p>`;
    expect(insertMarkupHtml(editor, markupToHtml(html, "html"), keepNone)).toBe(true);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "|")).toContain("Title|deep|after");
    expect(countType(editor, "heading")).toBe(1);
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
    expectStorable(editor);
  });

  it("markup that fits keeps its structure, up to the last level the limit allows", () => {
    // doc (1) > 61 quotes (2–62) > paragraph (63) > text (64): exactly at the limit.
    const editor = newEditor(doc(p()));
    expect(insertMarkupHtml(editor, markdownToHtml(`${"> ".repeat(61)}fits`), keepNone)).toBe(true);
    expect(countType(editor, "blockquote")).toBe(61);
    expect(depthOf(editor.getJSON())).toBe(MAX_NODE_DEPTH);
    expectStorable(editor);
  });

  it("one level more is flattened", () => {
    const editor = newEditor(doc(p()));
    expect(insertMarkupHtml(editor, markdownToHtml(`${"> ".repeat(62)}deep`), keepNone)).toBe(true);
    expect(countType(editor, "blockquote")).toBe(0);
    expect(editor.getText()).toContain("deep");
    expectStorable(editor);
  });
});

describe("pasting (RD-063)", () => {
  it("<p>x</p>, 70 nested quotes, <p>y</p> pasted into a paragraph: flattened, every text kept, the page still saves", () => {
    const editor = newEditor(doc(p(text("ab"))));
    editor.commands.setTextSelection(2);
    editor.view.pasteHTML(`<p>x</p>${"<blockquote>".repeat(70)}<p>deep</p>${"</blockquote>".repeat(70)}<p>y</p>`, pasteEvent());
    const all = editor.state.doc.textBetween(0, editor.state.doc.content.size, "|");
    expect(all).toContain("x");
    expect(all).toContain("deep");
    expect(all).toContain("y");
    expect(countType(editor, "blockquote")).toBe(0);
    expectStorable(editor);
  });

  it("a paste that fits keeps its structure", () => {
    const editor = newEditor(doc(p(text("ab"))));
    editor.commands.setTextSelection(2);
    editor.view.pasteHTML("<p>x</p><blockquote><blockquote><p>q</p></blockquote></blockquote><ul><li><p>li</p></li></ul><p>y</p>", pasteEvent());
    expect(countType(editor, "blockquote")).toBe(2);
    expect(countType(editor, "bulletList")).toBe(1);
    expectStorable(editor);
  });

  it("a paste that fits at the top level but not at a deep caret is flattened there", () => {
    const editor = newEditor(doc(quotes(58, "inside")));
    select(editor, "inside", true);
    editor.view.pasteHTML("<p>x</p><blockquote><blockquote><blockquote><blockquote><p>q</p></blockquote></blockquote></blockquote></blockquote><p>y</p>", pasteEvent());
    expect(countType(editor, "blockquote")).toBe(58);
    expect(editor.getText()).toContain("q");
    expectStorable(editor);
  });
});

describe("⇥ on a list item (RD-063)", () => {
  it("sinks while the result fits: the innermost text reaches 63", () => {
    const editor = newEditor(nestedList(28));
    select(editor, "b", true);
    expect(canShiftIndent(editor, 1)).toBe(true);
    expect(shiftIndent(editor, 1)).toBe(true);
    expect(depthOf(editor.getJSON())).toBe(63);
    expectStorable(editor);
  });

  it("refuses the sink that would go past 64, and the Indent button says so by being disabled", () => {
    const editor = newEditor(nestedList(29));
    select(editor, "b", true);
    const before = editor.getJSON();
    expect(canShiftIndent(editor, 1)).toBe(false);
    expect(toolbarState(editor).canIndent).toBe(false);
    expect(shiftIndent(editor, 1)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    // ⇤ still works.
    expect(canShiftIndent(editor, -1)).toBe(true);
  });

  it("pressing ⇥ on every item for as long as it is enabled never builds a document the server refuses", () => {
    const items = Array.from({ length: 34 }, (_, i) => ({ type: "listItem", content: [p(text(`item ${i + 1}`))] }));
    const editor = newEditor(doc({ type: "bulletList", content: items }));
    let presses = 0;
    for (let i = 2; i <= 34; i++) {
      select(editor, `item ${i}`, true);
      while (canShiftIndent(editor, 1) && presses < 2000) {
        // An enabled ⇥ always does something: it is never refused behind the user's back.
        const before = editor.state.doc;
        expect(shiftIndent(editor, 1)).toBe(true);
        expect(editor.state.doc.eq(before)).toBe(false);
        presses += 1;
      }
    }
    expect(presses).toBeGreaterThan(400);
    expect(depthOf(editor.getJSON())).toBeLessThanOrEqual(MAX_NODE_DEPTH);
    expectStorable(editor);
  });
});

describe("the depth backstop: every other path (RD-063)", () => {
  it("wrapping in a quote again and again stops at the limit", () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    for (let i = 0; i < 70; i++) editor.commands.wrapIn("blockquote");
    // doc (1) > 61 quotes > paragraph (63) > text (64).
    expect(countType(editor, "blockquote")).toBe(61);
    expectStorable(editor);
  });

  it("Tab in a list (the schema's own sinkListItem binding) cannot go past the limit", () => {
    const editor = newEditor(nestedList(29));
    select(editor, "b", true);
    const before = editor.getJSON();
    editor.commands.sinkListItem("listItem");
    expect(editor.getJSON()).toEqual(before);
    expectStorable(editor);
  });

  it("a table inside a table cell, again and again, stops at the limit", () => {
    const editor = newEditor(doc(p()));
    for (let i = 0; i < 30; i++) editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false });
    expect(countType(editor, "table")).toBeGreaterThan(15);
    expectStorable(editor);
  });

  it("typing stays possible right at the limit", () => {
    const editor = newEditor(doc(quotes(61, "edge")));
    select(editor, "edge", true);
    editor.commands.insertContent("typed ");
    expect(editor.getText()).toContain("typed edge");
    expectStorable(editor);
  });

  it("a change elsewhere in a document is not refused because of it", () => {
    const editor = newEditor(doc(p(text("top")), quotes(61, "edge")));
    select(editor, "top", true);
    editor.commands.insertContent("more ");
    expect(posOf(editor, "more top")).toBeGreaterThan(0);
  });
});
