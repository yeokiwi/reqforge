// @vitest-environment jsdom
// What the `+ ▾` menu, the `{` suggestions and the macro browser insert (insert-commands.ts), in a
// real editor: each node is built valid or refused (RD-068), lands somewhere the schema allows,
// and goes in as ONE undo step, the `{query` text included.
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachmentRef } from "@/domain/documents/api-types";
import { validateDocumentJson } from "@/editor/schema";
import {
  attachmentContent,
  attachmentSrc,
  findNodePos,
  insertAttachmentAt,
  insertDate,
  insertInfoPanel,
  insertMacro,
  insertMention,
  insertStatus,
  insertTableOfContents,
  insertText,
  mentionLabel,
  runInsert,
  todayValue,
  updateDate,
  updateStatus,
} from "../insert-commands";
import { INSERT_MENU } from "../insert-menu-items";
import { runInsertItem } from "../insert-menu";
import { RECENT_MACROS_KEY } from "../macros";
import { EditorUiBridge } from "../ui-bridge";
import { doc, newEditor, p, posOf, text } from "./editor-harness";

const types = (editor: Editor) => (editor.getJSON().content ?? []).map((n) => n.type);
const storable = (editor: Editor) => validateDocumentJson(editor.getJSON()).ok;

function ref(over: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    id: "att1",
    filename: "diagram.png",
    contentType: "image/png",
    size: 10,
    url: "/api/v1/attachments/att1/diagram.png",
    image: true,
    uploadedBy: { id: "u1", name: "A" },
    createdAt: "t",
    ...over,
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Info (info panel)", () => {
  it("in an empty paragraph, makes it the panel's first paragraph, caret inside", () => {
    const editor = newEditor(doc(p()));
    expect(runInsert(editor, insertInfoPanel)).toBe(true);
    expect(types(editor)).toEqual(["infoPanel"]);
    expect(editor.state.selection.$from.node(1).type.name).toBe("infoPanel");
    expect(storable(editor)).toBe(true);
  });

  it("with the caret in text, adds an empty panel after the paragraph", () => {
    const editor = newEditor(doc(p(text("hello"))));
    editor.commands.setTextSelection(3);
    runInsert(editor, insertInfoPanel);
    expect(types(editor)).toEqual(["paragraph", "infoPanel"]);
    expect(editor.state.doc.textContent).toBe("hello");
  });

  it("with a range selected, wraps the selected blocks", () => {
    const editor = newEditor(doc(p(text("a")), p(text("b"))));
    editor.commands.setTextSelection({ from: 1, to: 5 });
    runInsert(editor, insertInfoPanel);
    expect(types(editor)).toEqual(["infoPanel"]);
    expect(editor.getJSON().content?.[0]?.content).toHaveLength(2);
  });
});

describe("Status, Date, User mention, Symbol", () => {
  it("Status inserts a grey `Status` lozenge at the caret and returns its position", () => {
    const editor = newEditor(doc(p(text("ab"))));
    editor.commands.setTextSelection(2);
    const pos = runInsert(editor, insertStatus, (x) => x !== null);
    expect(pos).toBe(2);
    expect(editor.state.doc.nodeAt(2)?.attrs).toMatchObject({ text: "Status", colour: "grey" });
    expect(storable(editor)).toBe(true);
  });

  it("an inline node in a code block goes into a new paragraph after it, never into the code", () => {
    const editor = newEditor({ type: "doc", content: [{ type: "codeBlock", content: [text("code")] }] });
    editor.commands.setTextSelection(3);
    const pos = runInsert(editor, (tr) => insertDate(tr, "2026-10-09"), (x) => x !== null);
    expect(pos).not.toBeNull();
    expect(types(editor)).toEqual(["codeBlock", "paragraph"]);
    expect(editor.state.doc.child(0).textContent).toBe("code");
    expect(storable(editor)).toBe(true);
  });

  it("Date refuses a value that is not a real date (RD-068)", () => {
    const editor = newEditor(doc(p()));
    const before = editor.getJSON();
    for (const bad of ["2026-02-29", "2026-13-01", "0000-01-01", "", "9/10/2026"]) {
      expect(runInsert(editor, (tr) => insertDate(tr, bad), (x) => x !== null), bad).toBeNull();
    }
    expect(editor.getJSON()).toEqual(before);
  });

  it("todayValue is the local calendar day, zero-padded", () => {
    expect(todayValue(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayValue(new Date(5, 11, 31))).toBe("1905-12-31");
  });

  it("User mention inserts an atom keyed by the user id; refuses a malformed id", () => {
    const editor = newEditor(doc(p()));
    expect(runInsert(editor, (tr) => insertMention(tr, { id: "u_42", name: "Ann Lee" }), (x) => x !== null)).not.toBeNull();
    expect(editor.state.doc.firstChild?.firstChild?.attrs).toEqual({ userId: "u_42", label: "Ann Lee" });
    expect(runInsert(editor, (tr) => insertMention(tr, { id: "bad id/1", name: "X" }), (x) => x !== null)).toBeNull();
    expect(runInsert(editor, (tr) => insertMention(tr, { id: "u1", name: "   " }), (x) => x !== null)).toBeNull();
    expect(storable(editor)).toBe(true);
  });

  it("a mention label is cut to 255 UTF-16 units without splitting an emoji, and stripped of what cannot be stored", () => {
    const long = `${"a".repeat(254)}😀tail`;
    expect(mentionLabel(long)).toBe("a".repeat(254));
    expect(mentionLabel(`An\u0000n\uD83D`)).toBe("Ann");
    expect(mentionLabel("")).toBeNull();
  });

  it("Symbol inserts plain text with the marks at the caret", () => {
    const editor = newEditor(doc(p(text("ab", [{ type: "bold" }]))));
    editor.commands.setTextSelection(2);
    runInsert(editor, (tr) => insertText(tr, "§"));
    expect(editor.getText()).toBe("a§b");
    expect(runInsert(editor, (tr) => insertText(tr, "\u0000"))).toBeNull();
  });
});

describe("Table of Contents", () => {
  it("is a block placed where ProseMirror puts one", () => {
    const editor = newEditor(doc(p(text("a"))));
    editor.commands.setTextSelection(2);
    runInsert(editor, insertTableOfContents);
    expect(types(editor)).toContain("tableOfContents");
    expect(storable(editor)).toBe(true);
  });
});

describe("editing a status or a date", () => {
  it("updateStatus sets text and colour; refuses empty, over-long or multi-line text", () => {
    const editor = newEditor(doc(p({ type: "status", attrs: { text: "Old", colour: "grey" } })));
    const ok = (input: { text: string; colour: "grey" | "green" }) => editor.chain().command(({ tr }) => updateStatus(tr, 1, input)).run();
    expect(ok({ text: "  In   progress ", colour: "green" })).toBe(true);
    expect(editor.state.doc.nodeAt(1)?.attrs).toEqual({ text: "In progress", colour: "green" });
    expect(ok({ text: "   ", colour: "grey" })).toBe(false);
    expect(ok({ text: "x".repeat(61), colour: "grey" })).toBe(true); // normalised: cut to 60
    expect(editor.state.doc.nodeAt(1)?.attrs.text).toHaveLength(60);
    expect(editor.chain().command(({ tr }) => updateStatus(tr, 0, { text: "x", colour: "grey" })).run()).toBe(false);
    expect(storable(editor)).toBe(true);
  });

  it("updateDate refuses a value that is not a real date", () => {
    const editor = newEditor(doc(p({ type: "date", attrs: { value: "2026-01-01" } })));
    expect(editor.chain().command(({ tr }) => updateDate(tr, 1, "2026-02-30")).run()).toBe(false);
    expect(editor.chain().command(({ tr }) => updateDate(tr, 1, "2024-02-29")).run()).toBe(true);
    expect(editor.state.doc.nodeAt(1)?.attrs.value).toBe("2024-02-29");
  });

  it("findNodePos follows a node through edits made around it", () => {
    const editor = newEditor(doc(p(text("ab"), { type: "status", attrs: { text: "S", colour: "grey" } })));
    const node = editor.state.doc.nodeAt(3);
    expect(node?.type.name).toBe("status");
    editor.commands.insertContentAt(1, "xyz");
    expect(findNodePos(editor.state.doc, node as never)).toBe(6);
  });
});

describe("attachments (RD-058)", () => {
  it("an image attachment becomes an image node; any other file a link named after it", () => {
    const editor = newEditor(doc(p()));
    const tr = editor.state.tr;
    expect(attachmentContent(tr, ref())?.toJSON()).toEqual({
      type: "image",
      attrs: { attachmentId: "att1", src: "/api/v1/attachments/att1/diagram.png", alt: "diagram.png", title: null, width: null },
    });
    const link = attachmentContent(tr, ref({ image: false, filename: "spec.pdf", url: "/api/v1/attachments/att1/spec.pdf" }));
    expect(link?.text).toBe("spec.pdf");
    expect(link?.marks[0]?.attrs.href).toBe("/api/v1/attachments/att1/spec.pdf");
  });

  it("builds a valid URL when the server's is unusable, and refuses when none can be made", () => {
    expect(attachmentSrc({ id: "att1", filename: "a b.png", url: "https://cdn/x" })).toBe("/api/v1/attachments/att1/a%20b.png");
    expect(attachmentSrc({ id: "bad/id", filename: "a.png", url: "nope" })).toBeNull();
  });

  it("inserts at the given position; inside a code block, in a new paragraph after it", () => {
    const editor = newEditor({ type: "doc", content: [{ type: "codeBlock", content: [text("c")] }] });
    const tr = editor.state.tr;
    expect(insertAttachmentAt(tr, 2, ref())).toBe(true);
    editor.view.dispatch(tr);
    expect(types(editor)).toEqual(["codeBlock", "paragraph"]);
    expect(storable(editor)).toBe(true);
  });
});

describe("insertMacro (one undo step, recency recorded)", () => {
  it("deletes the `{query` text and inserts Info in ONE undo step", () => {
    const ui = new EditorUiBridge();
    const editor = newEditor(doc(p(text("x {inf"))), ui);
    const from = posOf(editor, "x {inf") + 2;
    expect(insertMacro(editor, "info", { range: { from, to: from + 4 }, ui })).toBe(true);
    expect(editor.state.doc.textContent).not.toContain("{inf");
    expect(JSON.stringify(editor.getJSON())).toContain("infoPanel");
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("x {inf");
    expect(JSON.stringify(editor.getJSON())).not.toContain("infoPanel");
  });

  it("Status opens its editor at once, and the macro is remembered for the `{` list", () => {
    const ui = new EditorUiBridge();
    const editNode = vi.fn();
    const macroInserted = vi.fn();
    ui.setHandlers({ editNode, macroInserted });
    const editor = newEditor(doc(p(text("a"))), ui);
    editor.commands.setTextSelection(2);
    insertMacro(editor, "status", { ui });
    expect(editNode).toHaveBeenCalledWith({ kind: "status", pos: 2 });
    expect(macroInserted).toHaveBeenCalledWith("status");
    expect(JSON.parse(window.localStorage.getItem(RECENT_MACROS_KEY) ?? "[]")).toEqual(["status"]);
  });

  it("inserts even when localStorage throws", () => {
    const ui = new EditorUiBridge();
    const editor = newEditor(doc(p()), ui);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(insertMacro(editor, "toc", { ui })).toBe(true);
    expect(types(editor)).toContain("tableOfContents");
  });

  it("does nothing for a macro that is not built (Requirement, Gallery), or a read-only editor", () => {
    const ui = new EditorUiBridge();
    const editor = newEditor(doc(p(text("x"))), ui);
    const before = editor.getJSON();
    expect(insertMacro(editor, "requirement", { ui })).toBe(false);
    expect(insertMacro(editor, "gallery", { ui })).toBe(false);
    editor.setEditable(false);
    expect(insertMacro(editor, "info", { ui })).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
});

describe("the `+ ▾` menu's direct items", () => {
  const actions = () => ({
    chooseFiles: vi.fn(),
    openLink: vi.fn(),
    openMarkup: vi.fn(),
    openDate: vi.fn(),
    openSymbol: vi.fn(),
    openMention: vi.fn(),
    openMacroBrowser: vi.fn(),
  });
  const item = (id: string) => {
    const found = INSERT_MENU.find((i) => i.id === id);
    if (!found) throw new Error(id);
    return found;
  };

  it("Horizontal rule and Task list act on the editor at once", () => {
    const ui = new EditorUiBridge();
    const editor = newEditor(doc(p(text("a"))), ui);
    editor.commands.setTextSelection(2);
    runInsertItem(item("horizontalRule"), editor, ui, actions());
    expect(types(editor)).toContain("horizontalRule");
    runInsertItem(item("taskList"), editor, ui, actions());
    expect(JSON.stringify(editor.getJSON())).toContain("taskList");
    expect(storable(editor)).toBe(true);
  });

  it("items that need input open their dialog; disabled items do nothing", () => {
    const ui = new EditorUiBridge();
    const editor = newEditor(doc(p()), ui);
    const a = actions();
    for (const [id, fn] of [
      ["files", a.chooseFiles],
      ["link", a.openLink],
      ["markup", a.openMarkup],
      ["date", a.openDate],
      ["symbol", a.openSymbol],
      ["mention", a.openMention],
      ["otherMacros", a.openMacroBrowser],
    ] as const) {
      runInsertItem(item(id), editor, ui, a);
      expect(fn, id).toHaveBeenCalledTimes(1);
    }
    const before = editor.getJSON();
    for (const id of ["externalIssue", "gallery", "requirement"]) runInsertItem(item(id), editor, ui, a);
    expect(editor.getJSON()).toEqual(before);
  });
});
