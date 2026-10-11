// @vitest-environment jsdom
// The editor's node views (node-views.ts): the same DOM contract as the page view, every user
// value written as text (never parsed as HTML), the info panel's variant switcher as one undoable
// transaction, status and date opening their editors, and the table of contents a live preview
// whose anchors are the page view's `rf-h-` ids.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";
import { HEADING_ID_PREFIX, collectHeadings } from "@/editor/schema";
import { headingsWithPositions, setPanelVariant, tableOfContentsEntries } from "../node-views";
import { EditorUiBridge } from "../ui-bridge";
import { doc, newEditor, p, text } from "./editor-harness";

const HOSTILE = '<img src=x onerror="window.__pwned=1">';
const heading = (level: number, value: string) => ({ type: "heading", attrs: { level }, content: [text(value)] });
const panel = (variant: string, ...content: ReturnType<typeof p>[]) => ({ type: "infoPanel", attrs: { variant }, content });

function root(editor: Editor): HTMLElement {
  return editor.view.dom;
}

describe("info panel", () => {
  it("draws the page view's classes and an editable content area", () => {
    const editor = newEditor(doc(panel("warning", p(text("Careful")))));
    const el = root(editor).querySelector('[data-type="infoPanel"]');
    expect(el?.className).toBe("rf-panel rf-panel--warning");
    expect(el?.getAttribute("data-variant")).toBe("warning");
    expect(el?.querySelector(".rf-panel__content")?.textContent).toBe("Careful");
    expect(el?.querySelector(".rf-panel__controls")?.getAttribute("contenteditable")).toBe("false");
  });

  it("the Panel type switcher is a labelled select of the five variants, set to the current one", () => {
    const editor = newEditor(doc(panel("note", p(text("x")))));
    const select = root(editor).querySelector("select");
    expect(select?.getAttribute("aria-label")).toBe("Panel type");
    expect(Array.from(select?.options ?? []).map((o) => [o.value, o.textContent])).toEqual([
      ["info", "Info"],
      ["note", "Note"],
      ["success", "Success"],
      ["warning", "Warning"],
      ["error", "Error"],
    ]);
    expect(select?.value).toBe("note");
  });

  it("changing it sets the variant in one undoable transaction, and the view follows", () => {
    const editor = newEditor(doc(panel("info", p(text("x")))));
    const select = root(editor).querySelector("select") as HTMLSelectElement;
    select.value = "error";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.state.doc.firstChild?.attrs.variant).toBe("error");
    expect(root(editor).querySelector('[data-type="infoPanel"]')?.className).toBe("rf-panel rf-panel--error");
    editor.commands.undo();
    expect(editor.state.doc.firstChild?.attrs.variant).toBe("info");
    expect(select.value).toBe("info");
  });

  it("does nothing while the editor is read-only (an Update in progress)", () => {
    const editor = newEditor(doc(panel("info", p(text("x")))));
    editor.setEditable(false);
    const select = root(editor).querySelector("select") as HTMLSelectElement;
    select.value = "success";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.state.doc.firstChild?.attrs.variant).toBe("info");
    expect(select.value).toBe("info");
  });

  it("setPanelVariant refuses an unknown variant or a position that is not a panel", () => {
    const editor = newEditor(doc(panel("info", p(text("x")))));
    expect(setPanelVariant(editor.state.tr, 0, "nope")).toBe(false);
    expect(setPanelVariant(editor.state.tr, 1, "note")).toBe(false);
    expect(setPanelVariant(editor.state.tr, 0, "info")).toBe(false); // unchanged
    expect(setPanelVariant(editor.state.tr, 0, "note")).toBe(true);
  });
});

describe("status and date", () => {
  it("render as the page view does, with the text as text — never as HTML", () => {
    const editor = newEditor(doc(p({ type: "status", attrs: { text: HOSTILE.slice(0, 60), colour: "red" } }, { type: "date", attrs: { value: "2026-10-09" } })));
    const status = root(editor).querySelector('[data-type="status"]');
    expect(status?.className).toBe("rf-status rf-status--red");
    expect(status?.textContent).toBe(HOSTILE.slice(0, 60));
    expect(status?.querySelector("img")).toBeNull();
    const date = root(editor).querySelector('[data-type="date"]');
    expect(date?.tagName).toBe("TIME");
    expect(date?.getAttribute("datetime")).toBe("2026-10-09");
    expect(date?.textContent).toBe("Oct 9, 2026");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("a click selects the atom and asks for its editor", () => {
    const ui = new EditorUiBridge();
    const editNode = vi.fn();
    ui.setHandlers({ editNode });
    const editor = newEditor(doc(p(text("a"), { type: "status", attrs: { text: "Done", colour: "green" } }, { type: "date", attrs: { value: "2026-01-02" } })), ui);
    (root(editor).querySelector('[data-type="status"]') as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(editNode).toHaveBeenLastCalledWith({ kind: "status", pos: 2 });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    (root(editor).querySelector('[data-type="date"]') as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(editNode).toHaveBeenLastCalledWith({ kind: "date", pos: 3 });
  });

  it("a click does nothing while the editor is read-only", () => {
    const ui = new EditorUiBridge();
    const editNode = vi.fn();
    ui.setHandlers({ editNode });
    const editor = newEditor(doc(p({ type: "status", attrs: { text: "S", colour: "grey" } })), ui);
    editor.setEditable(false);
    (root(editor).querySelector('[data-type="status"]') as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editNode).not.toHaveBeenCalled();
  });

  it("the view follows an edit of the node", () => {
    const editor = newEditor(doc(p({ type: "status", attrs: { text: "Old", colour: "grey" } })));
    editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { text: "New", colour: "blue" }));
    const status = root(editor).querySelector('[data-type="status"]');
    expect(status?.textContent).toBe("New");
    expect(status?.className).toBe("rf-status rf-status--blue");
  });
});

describe("mention", () => {
  it("is `@label`, as text, keyed by the user id", () => {
    const editor = newEditor(doc(p({ type: "mention", attrs: { userId: "u1", label: HOSTILE } })));
    const mention = root(editor).querySelector('[data-type="mention"]');
    expect(mention?.textContent).toBe(`@${HOSTILE}`);
    expect(mention?.getAttribute("data-user-id")).toBe("u1");
    expect(mention?.querySelector("img")).toBeNull();
  });
});

describe("table of contents", () => {
  const toc = { type: "tableOfContents" };

  it("lists the headings with the page view's `rf-h-` anchors, nested by level", () => {
    const editor = newEditor(doc(toc, heading(1, "Intro"), heading(2, "Scope"), heading(1, "Intro")));
    const links = Array.from(root(editor).querySelectorAll(".rf-toc a"));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Intro", `#${HEADING_ID_PREFIX}intro`],
      ["Scope", `#${HEADING_ID_PREFIX}scope`],
      ["Intro", `#${HEADING_ID_PREFIX}intro-1`],
    ]);
    expect(Array.from(root(editor).querySelectorAll(".rf-toc__item")).map((li) => li.getAttribute("data-level"))).toEqual(["1", "2", "1"]);
    // the same ids the page view gives the headings
    expect(collectHeadings(editor.getJSON()).map((h) => h.id)).toEqual(links.map((a) => a.getAttribute("href")?.slice(1)));
  });

  it("is live: it follows headings added, renamed and removed", () => {
    const editor = newEditor(doc(toc, heading(1, "One")));
    editor.commands.insertContentAt(editor.state.doc.content.size, heading(2, "Two"));
    expect(Array.from(root(editor).querySelectorAll(".rf-toc a")).map((a) => a.textContent)).toEqual(["One", "Two"]);
    editor.commands.insertContentAt(2, "Uno "); // the toc is 0, the heading opens at 1, its text at 2
    expect(root(editor).querySelector(".rf-toc a")?.textContent).toBe("Uno One");
    editor.commands.setContent(doc(toc, p(text("no headings"))));
    expect(root(editor).querySelector(".rf-toc a")).toBeNull();
  });

  it("says so when there are no headings", () => {
    const editor = newEditor(doc(toc, p(text("x"))));
    expect(root(editor).querySelector(".rf-toc__empty")?.textContent).toBe("Add headings to this page to fill the table of contents.");
  });

  it("writes heading text as text", () => {
    const editor = newEditor(doc(toc, heading(1, HOSTILE)));
    expect(root(editor).querySelector(".rf-toc a")?.textContent).toBe(HOSTILE);
    expect(root(editor).querySelector(".rf-toc img")).toBeNull();
  });

  it("respects the node's level range and finds headings inside containers", () => {
    const editor = newEditor(
      doc({ type: "tableOfContents", attrs: { minLevel: 2, maxLevel: 3 } }, heading(1, "Top"), panel("info", p(text("x"))), heading(2, "Two"), heading(4, "Four")),
    );
    expect(tableOfContentsEntries(editor.state.doc, 2, 3).map((e) => e.text)).toEqual(["Two"]);
    expect(Array.from(root(editor).querySelectorAll(".rf-toc a")).map((a) => a.textContent)).toEqual(["Two"]);
    expect(headingsWithPositions(editor.state.doc).map((h) => h.level)).toEqual([1, 2, 4]);
  });

  it("a click on an entry moves the caret to that heading instead of navigating", () => {
    const editor = newEditor(doc(toc, p(text("body")), heading(2, "Target")));
    const link = root(editor).querySelector(".rf-toc a") as HTMLAnchorElement;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("Target");
  });
});
