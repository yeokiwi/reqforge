// @vitest-environment jsdom
// What the toolbar buttons do (10 §5.1, read as RD-057 reads the glyphs), run on a real editor
// with the UI's extension list. Every result must still be content the server stores: a toolbar
// button that produces a refused document would make every later autosave fail.
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { validateDocumentJson } from "@/editor/schema";
import {
  applyLink,
  clearFormatting,
  currentBlockStyle,
  insertEmoji,
  insertTable,
  linkTarget,
  removeLink,
  setAlignment,
  setBlockStyle,
  setCellBackground,
  setTableWidthMode,
  setTextColour,
  shiftIndent,
  tableToolbarState,
  toggleInfoPanel,
  toggleNumberedColumn,
  toolbarState,
} from "../commands";
import { doc, newEditor, p, posOf, select, table, text } from "./editor-harness";

function expectStorable(editor: Editor): void {
  const result = validateDocumentJson(editor.getJSON());
  expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
}

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; marks?: Json[]; text?: string };
const json = (editor: Editor) => editor.getJSON() as Json;
const first = (editor: Editor) => json(editor).content?.[0];

describe("Paragraph ▾ (Normal, Heading 1–6, Quote, Preformatted)", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)("Heading %i turns the paragraph into a heading of that level", (level) => {
    const editor = newEditor(doc(p(text("Title"))));
    select(editor, "Title", true);
    expect(setBlockStyle(editor, `h${level}`)).toBe(true);
    expect(first(editor)?.type).toBe("heading");
    expect(first(editor)?.attrs?.level).toBe(level);
    expect(currentBlockStyle(editor)).toBe(`h${level}`);
    expectStorable(editor);
  });

  it("Quote wraps the block in a blockquote; Normal lifts it out again", () => {
    const editor = newEditor(doc(p(text("Quoted"))));
    select(editor, "Quoted", true);
    setBlockStyle(editor, "quote");
    expect(first(editor)?.type).toBe("blockquote");
    expect(currentBlockStyle(editor)).toBe("quote");
    setBlockStyle(editor, "normal");
    expect(first(editor)?.type).toBe("paragraph");
    expect(currentBlockStyle(editor)).toBe("normal");
    expectStorable(editor);
  });

  it("Preformatted makes a code block; Normal makes it a paragraph", () => {
    const editor = newEditor(doc(p(text("code"))));
    select(editor, "code", true);
    setBlockStyle(editor, "preformatted");
    expect(first(editor)?.type).toBe("codeBlock");
    expect(currentBlockStyle(editor)).toBe("preformatted");
    setBlockStyle(editor, "normal");
    expect(first(editor)?.type).toBe("paragraph");
    expectStorable(editor);
  });

  it("choosing the style the block already has changes nothing", () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    expect(setBlockStyle(editor, "normal")).toBe(false);
    setBlockStyle(editor, "h2");
    expect(setBlockStyle(editor, "h2")).toBe(false);
  });

  it("each style change is one undo step", () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    setBlockStyle(editor, "quote");
    editor.commands.undo();
    expect(first(editor)?.type).toBe("paragraph");
  });
});

describe("⇤ ⇥ (RD-057: lists lift and sink; paragraphs and headings change indent 0–6)", () => {
  it("indents a paragraph one level per press, up to 6, and outdents back to 0", () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    for (let i = 1; i <= 6; i++) {
      expect(shiftIndent(editor, 1)).toBe(true);
      expect(first(editor)?.attrs?.indent).toBe(i);
    }
    expect(shiftIndent(editor, 1)).toBe(false);
    expect(first(editor)?.attrs?.indent).toBe(6);
    expect(toolbarState(editor).canIndent).toBe(false);
    for (let i = 5; i >= 0; i--) shiftIndent(editor, -1);
    expect(first(editor)?.attrs?.indent).toBe(0);
    expect(toolbarState(editor).canOutdent).toBe(false);
    expectStorable(editor);
  });

  it("indents every selected paragraph and heading", () => {
    const editor = newEditor(doc({ type: "heading", attrs: { level: 2 }, content: [text("H")] }, p(text("P"))));
    editor.commands.setTextSelection({ from: posOf(editor, "H"), to: posOf(editor, "P") + 1 });
    shiftIndent(editor, 1);
    expect(json(editor).content?.map((n) => n.attrs?.indent)).toEqual([1, 1]);
  });

  it("in a list, sinks and lifts the item instead of indenting", () => {
    const editor = newEditor(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(text("one"))] },
          { type: "listItem", content: [p(text("two"))] },
        ],
      }),
    );
    select(editor, "two", true);
    expect(shiftIndent(editor, 1)).toBe(true);
    const list = first(editor);
    expect(list?.content).toHaveLength(1);
    expect(list?.content?.[0]?.content?.[1]?.type).toBe("bulletList");
    expect(shiftIndent(editor, -1)).toBe(true);
    expect(first(editor)?.content).toHaveLength(2);
    expectStorable(editor);
  });
});

describe("⫷ ⫸ ⫶ alignment (RD-057: left, right, centre)", () => {
  it("right and centre set the alignment; pressing them again or pressing left returns to the stored default", () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    setAlignment(editor, "right");
    expect(first(editor)?.attrs?.textAlign).toBe("right");
    setAlignment(editor, "right");
    expect(first(editor)?.attrs?.textAlign).toBeNull();
    setAlignment(editor, "center");
    expect(toolbarState(editor).align).toBe("center");
    setAlignment(editor, "left");
    expect(first(editor)?.attrs?.textAlign).toBeNull();
    expectStorable(editor);
  });
});

describe("marks, colour and clear formatting", () => {
  it("A▾ sets a palette colour as #rrggbb and the default removes it", () => {
    const editor = newEditor(doc(p(text("red"))));
    select(editor, "red");
    setTextColour(editor, "#a11911");
    expect(toolbarState(editor).textColour).toBe("#a11911");
    expectStorable(editor);
    setTextColour(editor, null);
    expect(toolbarState(editor).textColour).toBeNull();
  });

  it("clear formatting removes every text format but keeps links", () => {
    const editor = newEditor(
      doc(
        p(
          text("styled", [
            { type: "bold" },
            { type: "italic" },
            { type: "underline" },
            { type: "strike" },
            { type: "superscript" },
            { type: "link", attrs: { href: "https://example.com" } },
            { type: "textStyle", attrs: { color: "#a11911" } },
          ]),
        ),
      ),
    );
    select(editor, "styled");
    clearFormatting(editor);
    const marks = first(editor)?.content?.[0]?.marks?.map((m) => m.type);
    expect(marks).toEqual(["link"]);
    expectStorable(editor);
  });

  it("toolbarState reports the marks at the selection", () => {
    const editor = newEditor(doc(p(text("b", [{ type: "bold" }]), text("i", [{ type: "italic" }]))));
    select(editor, "b");
    expect(toolbarState(editor).marks).toMatchObject({ bold: true, italic: false });
    select(editor, "i");
    expect(toolbarState(editor).marks).toMatchObject({ bold: false, italic: true });
  });
});

describe("▭ info panel, ☺ emoji, ▦ table", () => {
  it("the info panel wraps the block and unwraps it again", () => {
    const editor = newEditor(doc(p(text("note"))));
    select(editor, "note", true);
    toggleInfoPanel(editor);
    expect(first(editor)?.type).toBe("infoPanel");
    expect(first(editor)?.attrs?.variant).toBe("info");
    expect(toolbarState(editor).infoPanel).toBe(true);
    expectStorable(editor);
    toggleInfoPanel(editor);
    expect(first(editor)?.type).toBe("paragraph");
  });

  it("an emoji is inserted as plain Unicode text", () => {
    const editor = newEditor(doc(p(text("ok "))));
    editor.commands.setTextSelection(posOf(editor, "ok ") + 3);
    insertEmoji(editor, "✅");
    expect(editor.getText()).toBe("ok ✅");
    expectStorable(editor);
  });

  it("the size grid inserts a table of that size with a header row", () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    insertTable(editor, 3, 4);
    const inserted = json(editor).content?.find((n) => n.type === "table");
    expect(inserted?.content).toHaveLength(3);
    expect(inserted?.content?.every((row) => row.content?.length === 4)).toBe(true);
    expect(inserted?.content?.[0]?.content?.every((c) => c.type === "tableHeader")).toBe(true);
    expectStorable(editor);
  });
});

describe("🔗 links", () => {
  it("links the selected text", () => {
    const editor = newEditor(doc(p(text("click here"))));
    select(editor, "click here");
    expect(applyLink(editor, { href: "https://example.com", text: "" })).toBe(true);
    expect(first(editor)?.content?.[0]?.marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
    expectStorable(editor);
  });

  it("with no selection and no text, inserts the address itself as the link text", () => {
    const editor = newEditor(doc(p(text("see "))));
    editor.commands.setTextSelection(posOf(editor, "see ") + 4);
    applyLink(editor, { href: "/spaces/TEAM/pages/1", text: "" });
    expect(editor.getText()).toBe("see /spaces/TEAM/pages/1");
    expectStorable(editor);
  });

  it("with text, replaces the selection by that text, linked", () => {
    const editor = newEditor(doc(p(text("old"))));
    select(editor, "old");
    applyLink(editor, { href: "mailto:a@example.com", text: "mail us" });
    expect(editor.getText()).toBe("mail us");
    expect(first(editor)?.content?.[0]?.marks?.[0]?.attrs?.href).toBe("mailto:a@example.com");
  });

  it("refuses an address the schema's link rule refuses, changing nothing", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "example.com", "#top", "http://"]) {
      const editor = newEditor(doc(p(text("x"))));
      select(editor, "x");
      expect(applyLink(editor, { href, text: "" })).toBe(false);
      expect(first(editor)?.content?.[0]?.marks).toBeUndefined();
    }
  });

  it("with the caret inside a link, edits and removes the whole link", () => {
    const editor = newEditor(doc(p(text("a "), text("linked", [{ type: "link", attrs: { href: "https://a.example" } }]), text(" b"))));
    editor.commands.setTextSelection(posOf(editor, "linked") + 2);
    const target = linkTarget(editor);
    expect(target.href).toBe("https://a.example");
    expect(target.text).toBe("linked");
    applyLink(editor, { href: "https://b.example", text: "" });
    expect(editor.getJSON()).toMatchObject({
      content: [{ content: [{ text: "a " }, { text: "linked", marks: [{ attrs: { href: "https://b.example" } }] }, { text: " b" }] }],
    });
    editor.commands.setTextSelection(posOf(editor, "linked") + 2);
    removeLink(editor);
    expect(editor.getText()).toBe("a linked b");
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"');
  });
});

describe("table row 2 (RD-057, RD-069)", () => {
  it("is null outside a table and describes the table inside one", () => {
    const editor = newEditor(doc(p(text("outside")), table()));
    select(editor, "outside", true);
    expect(tableToolbarState(editor)).toBeNull();
    expect(toolbarState(editor).table).toBeNull();
    select(editor, "A", true);
    expect(tableToolbarState(editor)).toMatchObject({ widthMode: "responsive", numbered: false, headerRow: true, headerColumn: false });
  });

  it("width mode sets the table's widthMode attribute", () => {
    const editor = newEditor(doc(table()));
    select(editor, "A", true);
    setTableWidthMode(editor, "fixed");
    expect(first(editor)?.attrs?.widthMode).toBe("fixed");
    expect(tableToolbarState(editor)?.widthMode).toBe("fixed");
    setTableWidthMode(editor, "responsive");
    expect(first(editor)?.attrs?.widthMode).toBe("responsive");
    expectStorable(editor);
  });

  it("num toggles the numberedColumn attribute without touching any row", () => {
    const editor = newEditor(doc(table()));
    select(editor, "A", true);
    const rowsBefore = JSON.stringify(first(editor)?.content);
    toggleNumberedColumn(editor);
    expect(first(editor)?.attrs?.numberedColumn).toBe(true);
    expect(JSON.stringify(first(editor)?.content)).toBe(rowsBefore);
    toggleNumberedColumn(editor);
    expect(first(editor)?.attrs?.numberedColumn).toBe(false);
    expectStorable(editor);
  });

  it("fill sets the background of the cell, or of every selected cell, and No fill clears it", () => {
    const editor = newEditor(doc(table()));
    select(editor, "A", true);
    setCellBackground(editor, "#deebff");
    expect(tableToolbarState(editor)?.background).toBe("#deebff");
    const $a = editor.state.doc.resolve(posOf(editor, "A"));
    const $b = editor.state.doc.resolve(posOf(editor, "B"));
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, $a.before($a.depth - 1), $b.before($b.depth - 1))));
    setCellBackground(editor, "#e3fcef");
    const bodyRow = first(editor)?.content?.[1];
    expect(bodyRow?.content?.map((c) => c.attrs?.background)).toEqual(["#e3fcef", "#e3fcef"]);
    setCellBackground(editor, null);
    expect(first(editor)?.content?.[1]?.content?.map((c) => c.attrs?.background)).toEqual([null, null]);
    expectStorable(editor);
  });

  it("header row and header column toggle, and say so", () => {
    const editor = newEditor(doc(table()));
    select(editor, "A", true);
    editor.chain().focus().toggleHeaderRow().run();
    expect(tableToolbarState(editor)?.headerRow).toBe(false);
    editor.chain().focus().toggleHeaderRow().run();
    expect(tableToolbarState(editor)?.headerRow).toBe(true);
    editor.chain().focus().toggleHeaderColumn().run();
    expect(tableToolbarState(editor)?.headerColumn).toBe(true);
    editor.chain().focus().toggleHeaderColumn().run();
    expect(tableToolbarState(editor)?.headerColumn).toBe(false);
    expectStorable(editor);
  });

  it("rows and columns are added and deleted around the caret, and the table can be deleted", () => {
    const editor = newEditor(doc(table()));
    select(editor, "A", true);
    editor.chain().focus().addRowBefore().run();
    editor.chain().focus().addRowAfter().run();
    expect(first(editor)?.content).toHaveLength(4);
    editor.chain().focus().addColumnBefore().run();
    editor.chain().focus().addColumnAfter().run();
    expect(first(editor)?.content?.[0]?.content).toHaveLength(4);
    editor.chain().focus().deleteRow().run();
    editor.chain().focus().deleteColumn().run();
    expect(first(editor)?.content).toHaveLength(3);
    expect(first(editor)?.content?.[0]?.content).toHaveLength(3);
    expectStorable(editor);
    expect(tableToolbarState(editor)?.can.deleteTable).toBe(true);
    editor.chain().focus().deleteTable().run();
    expect(json(editor).content?.some((n) => n.type === "table")).toBe(false);
  });

  it("merge across whole rows leaves a storable table (RD-065)", () => {
    const editor = newEditor(doc(table()));
    const $h = editor.state.doc.resolve(posOf(editor, "H1"));
    const $b = editor.state.doc.resolve(posOf(editor, "B"));
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, $h.before($h.depth - 1), $b.before($b.depth - 1))));
    expect(tableToolbarState(editor)?.can.mergeCells).toBe(true);
    editor.chain().focus().mergeCells().run();
    expectStorable(editor);
    expect(tableToolbarState(editor)?.can.splitCell).toBe(true);
    editor.chain().focus().splitCell().run();
    expectStorable(editor);
  });
});

describe("undo and redo", () => {
  it("toolbarState knows whether there is anything to undo or redo", () => {
    const editor = newEditor(doc(p(text("x"))));
    expect(toolbarState(editor).canUndo).toBe(false);
    select(editor, "x");
    editor.chain().focus().toggleBold().run();
    expect(toolbarState(editor).canUndo).toBe(true);
    editor.chain().focus().undo().run();
    expect(toolbarState(editor).canRedo).toBe(true);
  });
});
