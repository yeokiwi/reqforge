// @vitest-environment jsdom
// `{` Macro suggestions (10 §5.4) in a real editor: typing `{` opens the list in the drawn order;
// typing on filters; ArrowDown/ArrowUp skip the disabled items; Enter inserts as ONE undo step
// with the `{query` gone; Escape closes and Enter is the text's again; the order follows recency,
// also when localStorage throws; no list inside code.
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_MACROS_KEY, macroSuggestions } from "../macros";
import { MacroSuggestionController, nextEnabledIndex } from "../suggestion";
import { EditorUiBridge } from "../ui-bridge";
import { doc, newEditor, p, text } from "./editor-harness";

function setup(content = doc(p())) {
  const controller = new MacroSuggestionController();
  const ui = new EditorUiBridge(controller);
  const handlers = { openMacroBrowser: vi.fn(), editNode: vi.fn() };
  ui.setHandlers(handlers);
  const editor = newEditor(content, ui);
  editor.commands.focus("end");
  return { editor, controller, ui, handlers };
}

/** Types text at the caret, then lets the suggestion plugin's (async) view update run. */
async function type(editor: Editor, value: string): Promise<void> {
  for (const ch of value) editor.commands.insertContent(ch);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function key(editor: Editor, name: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

const labels = (c: MacroSuggestionController) => c.getSnapshot().items.map((i) => i.label);
const activeLabel = (c: MacroSuggestionController) => c.getSnapshot().items[c.getSnapshot().active]?.label;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("typing `{`", () => {
  it("opens Macro suggestions in the drawn order, the first enabled item highlighted", async () => {
    const { editor, controller } = setup();
    await type(editor, "{");
    expect(controller.getSnapshot().open).toBe(true);
    expect(labels(controller)).toEqual(["Info", "Status", "Gallery", "Table of Contents", "Requirement", "Open macro browser"]);
    expect(activeLabel(controller)).toBe("Info");
  });

  it("points the editor's text box at the list (aria-controls, aria-activedescendant) while it shows", async () => {
    const { editor, controller } = setup();
    await type(editor, "{");
    expect(editor.view.dom.getAttribute("aria-controls")).toBe(controller.id);
    expect(editor.view.dom.getAttribute("aria-activedescendant")).toBe(controller.optionId(0));
    key(editor, "Escape");
    expect(editor.view.dom.getAttribute("aria-controls")).toBeNull();
    expect(editor.view.dom.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("opens after a space or at the start of a text, not in the middle of a word", async () => {
    const { editor, controller } = setup(doc(p(text("word"))));
    await type(editor, "{");
    expect(controller.getSnapshot().open).toBe(false);
    await type(editor, " {");
    expect(controller.getSnapshot().open).toBe(true);
  });

  it("filters by name as the user types", async () => {
    const { editor, controller } = setup();
    await type(editor, "{req");
    expect(labels(controller)).toEqual(["Requirement", "Open macro browser"]);
    await type(editor, "zz");
    expect(controller.getSnapshot().open).toBe(false);
  });

  it("does not open inside a code block or inline code", async () => {
    const code = setup({ type: "doc", content: [{ type: "codeBlock", content: [text("x ")] }] });
    await type(code.editor, "{");
    expect(code.controller.getSnapshot().open).toBe(false);
    const inline = setup(doc(p(text("a ", [{ type: "code" }]))));
    inline.editor.commands.setTextSelection(3);
    await type(inline.editor, "{");
    expect(inline.controller.getSnapshot().open).toBe(false);
  });
});

describe("the keyboard", () => {
  it("ArrowDown and ArrowUp move between the enabled items only, wrapping", async () => {
    const { editor, controller } = setup();
    await type(editor, "{");
    expect(key(editor, "ArrowDown")).toBe(true);
    expect(activeLabel(controller)).toBe("Status");
    key(editor, "ArrowDown");
    expect(activeLabel(controller)).toBe("Table of Contents"); // Gallery is skipped
    key(editor, "ArrowDown");
    expect(activeLabel(controller)).toBe("Open macro browser"); // Requirement is skipped
    key(editor, "ArrowDown");
    expect(activeLabel(controller)).toBe("Info");
    key(editor, "ArrowUp");
    expect(activeLabel(controller)).toBe("Open macro browser");
  });

  it("Enter inserts the highlighted macro and removes `{query`, as ONE undo step", async () => {
    const { editor, controller } = setup(doc(p(text("Intro "))));
    await type(editor, "{tab");
    // A pause in typing: history starts a new group (as it would after 500 ms).
    editor.view.dispatch(closeHistory(editor.state.tr));
    const typed = editor.getJSON();
    expect(activeLabel(controller)).toBe("Table of Contents");
    let edits = 0;
    const count = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) edits += 1;
    };
    editor.on("transaction", count);
    expect(key(editor, "Enter")).toBe(true);
    editor.off("transaction", count);
    expect(edits).toBe(1);
    expect(editor.state.doc.textContent).toBe("Intro ");
    expect(JSON.stringify(editor.getJSON())).toContain("tableOfContents");
    expect(controller.getSnapshot().open).toBe(false);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(typed);
  });

  it("Enter on Status inserts it and opens its editor", async () => {
    const { editor, handlers } = setup();
    await type(editor, "{stat");
    key(editor, "Enter");
    expect(JSON.stringify(editor.getJSON())).toContain('"status"');
    expect(handlers.editNode).toHaveBeenCalledWith(expect.objectContaining({ kind: "status" }));
  });

  it("Enter on Open macro browser removes `{query` and opens the browser", async () => {
    const { editor, handlers } = setup();
    await type(editor, "{open");
    key(editor, "Enter");
    expect(editor.state.doc.textContent).toBe("");
    expect(handlers.openMacroBrowser).toHaveBeenCalledTimes(1);
  });

  it("a disabled item cannot be chosen, by keyboard or by mouse", async () => {
    const { editor, controller } = setup();
    await type(editor, "{gal");
    expect(labels(controller)).toEqual(["Gallery", "Open macro browser"]);
    expect(activeLabel(controller)).toBe("Open macro browser");
    expect(controller.chooseItem(0)).toBe(false);
    expect(editor.state.doc.textContent).toBe("{gal");
  });

  it("Escape closes the list and leaves the text; then Enter splits the paragraph as usual", async () => {
    const { editor, controller } = setup();
    await type(editor, "{inf");
    expect(key(editor, "Escape")).toBe(true);
    expect(controller.getSnapshot().open).toBe(false);
    expect(editor.state.doc.textContent).toBe("{inf");
    await type(editor, "o"); // still the same `{query`: stays closed
    expect(controller.getSnapshot().open).toBe(false);
    key(editor, "Enter");
    expect(editor.state.doc.childCount).toBe(2);
    expect(JSON.stringify(editor.getJSON())).not.toContain("infoPanel");
  });

  it("a new `{` after Escape opens the list again", async () => {
    const { editor, controller } = setup();
    await type(editor, "{x");
    key(editor, "Escape");
    await type(editor, " {");
    expect(controller.getSnapshot().open).toBe(true);
  });

  it("Shift+Enter and modified keys are not the list's", async () => {
    const { editor, controller } = setup();
    await type(editor, "{");
    expect(controller.handleKey({ key: "Enter", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, isComposing: false })).toBe(false);
    expect(controller.handleKey({ key: "ArrowDown", shiftKey: false, altKey: false, ctrlKey: true, metaKey: false, isComposing: false })).toBe(false);
    expect(controller.handleKey({ key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: true })).toBe(false);
  });
});

describe("recency (10 §5.4)", () => {
  it("reorders the list once something has been inserted", async () => {
    const first = setup();
    await type(first.editor, "{stat");
    key(first.editor, "Enter");
    expect(JSON.parse(window.localStorage.getItem(RECENT_MACROS_KEY) ?? "[]")).toEqual(["status"]);
    const second = setup();
    await type(second.editor, "{");
    expect(labels(second.controller)).toEqual(["Status", "Info", "Gallery", "Table of Contents", "Requirement", "Open macro browser"]);
  });

  it("still opens, in the drawn order, and still inserts, when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { editor, controller } = setup();
    await type(editor, "{");
    expect(labels(controller)).toEqual(["Info", "Status", "Gallery", "Table of Contents", "Requirement", "Open macro browser"]);
    key(editor, "Enter");
    expect(JSON.stringify(editor.getJSON())).toContain("infoPanel");
  });
});

describe("nextEnabledIndex", () => {
  it("skips disabled items in either direction and wraps; -1 when none is enabled", () => {
    const items = macroSuggestions("");
    expect(nextEnabledIndex(items, 2, 1)).toBe(3);
    expect(nextEnabledIndex(items, 4, -1)).toBe(3);
    expect(nextEnabledIndex(items, 6, 1)).toBe(0);
    const allDisabled = items.filter((i) => i.disabled);
    expect(nextEnabledIndex(allDisabled, 0, 1)).toBe(-1);
    expect(nextEnabledIndex([], 0, 1)).toBe(-1);
  });
});
