// @vitest-environment jsdom
// The pass-2 editor surfaces as components (jsdom): the `+ ▾` menu, the `{` list, the macro
// browser, the keyboard shortcuts dialog (generated from the one table), the Date, Status,
// Symbol, Markup and User mention dialogs, the find bar and the upload region. Copy comes from
// the deck; keyboard routes are exercised, not just clicks.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRef } from "@/domain/documents/api-types";
import { FindBar } from "../find-bar";
import { findState } from "../find-replace";
import { InsertMenu } from "../insert-menu";
import { MacroBrowser } from "../macro-browser";
import { MarkupDialog } from "../markup-dialog";
import { MENTION_SEARCH_DEBOUNCE_MS, MentionDialog } from "../mention-dialog";
import { DateDialog, StatusDialog, checkStatusText } from "../node-dialogs";
import { SHORTCUTS, keyCaps } from "../shortcuts";
import { ShortcutsDialog } from "../shortcuts-dialog";
import { MacroSuggestionController } from "../suggestion";
import { MacroSuggestionList } from "../suggestion-list";
import { SYMBOLS, SymbolDialog } from "../symbol-dialog";
import { EditorUiBridge } from "../ui-bridge";
import { UploadStatus } from "../upload-status";
import { doc, newEditor, p, stubLayout, text } from "./editor-harness";

beforeEach(() => {
  stubLayout();
  window.localStorage.clear(); // recency is per browser: one test's inserts reorder the next one's list
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const noop = () => undefined;

describe("the `+ ▾` Insert More Content menu (10 §5.5)", () => {
  const actions = {
    chooseFiles: vi.fn(),
    openLink: vi.fn(),
    openMarkup: vi.fn(),
    openDate: vi.fn(),
    openSymbol: vi.fn(),
    openMention: vi.fn(),
    openMacroBrowser: vi.fn(),
  };

  it("opens on its button and lists every item in the drawn order, with the later ones disabled", () => {
    const editor = newEditor(doc(p()));
    render(<InsertMenu editor={editor} ui={new EditorUiBridge()} disabled={false} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert more content" }));
    const menu = screen.getByRole("menu", { name: "Insert more content" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Files and images",
      "Link",
      "Markup",
      "Horizontal rule",
      "Task list",
      "Date",
      "Symbol",
      "User mention",
      "External issue",
      "Info",
      "Status",
      "Gallery",
      "Table of Contents",
      "Requirement",
      "Other macros",
    ]);
    const disabled = items.filter((i) => i.getAttribute("aria-disabled") === "true").map((i) => i.textContent);
    expect(disabled).toEqual(["External issue", "Gallery", "Requirement"]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
    expect(document.activeElement).toBe(items[0]);
  });

  it("is keyboard-operable: arrows skip the disabled items, Enter inserts, the menu closes", () => {
    const editor = newEditor(doc(p()));
    render(<InsertMenu editor={editor} ui={new EditorUiBridge()} disabled={false} actions={actions} />);
    const trigger = screen.getByRole("button", { name: "Insert more content" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Other macros");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Table of Contents"); // Requirement is skipped
    fireEvent.click(document.activeElement as Element);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(JSON.stringify(editor.getJSON())).toContain("tableOfContents");
  });

  it("a disabled item does nothing; the whole menu is disabled while the page is read-only", () => {
    const editor = newEditor(doc(p()));
    const before = editor.getJSON();
    const { rerender } = render(<InsertMenu editor={editor} ui={new EditorUiBridge()} disabled={false} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert more content" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Requirement" }));
    expect(editor.getJSON()).toEqual(before);
    rerender(<InsertMenu editor={editor} ui={new EditorUiBridge()} disabled actions={actions} />);
    expect(screen.getByRole("button", { name: "Insert more content" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the `{` Macro suggestions list (10 §5.4)", () => {
  it("renders nothing while closed, and the titled listbox while open", async () => {
    const controller = new MacroSuggestionController();
    const ui = new EditorUiBridge(controller);
    const editor = newEditor(doc(p()), ui);
    render(<MacroSuggestionList controller={controller} />);
    expect(screen.queryByTestId("macro-suggestions")).toBeNull();
    await act(async () => {
      editor.commands.insertContent("{");
      await new Promise((r) => setTimeout(r, 0));
    });
    const list = screen.getByRole("listbox", { name: "Macro suggestions" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["ⓘInfo", "═Status", "▦Gallery", "☰Table of Contents", "⛹Requirement", "···Open macro browser"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
    expect(options[4]).toHaveAttribute("aria-disabled", "true");
    expect(list.id).toBe(controller.id);
    expect(options[1]?.id).toBe(controller.optionId(1));
  });

  it("a click on an item inserts it; hovering highlights", async () => {
    const controller = new MacroSuggestionController();
    const ui = new EditorUiBridge(controller);
    const editor = newEditor(doc(p()), ui);
    render(<MacroSuggestionList controller={controller} />);
    await act(async () => {
      editor.commands.insertContent("{");
      await new Promise((r) => setTimeout(r, 0));
    });
    const toc = screen.getByRole("option", { name: /Table of Contents/ });
    fireEvent.mouseEnter(toc);
    expect(toc).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      fireEvent.click(toc);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(JSON.stringify(editor.getJSON())).toContain("tableOfContents");
    expect(screen.queryByTestId("macro-suggestions")).toBeNull();
  });
});

describe("the macro browser (10 §5.5 Other macros)", () => {
  it("lists every macro; the ones not built yet are disabled and say so", () => {
    const onChoose = vi.fn();
    render(<MacroBrowser onChoose={onChoose} onCancel={noop} />);
    const dialog = screen.getByRole("dialog", { name: "Macro browser" });
    const buttons = within(dialog)
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("data-macro"));
    expect(buttons.map((b) => b.getAttribute("data-macro"))).toEqual([
      "info",
      "status",
      "gallery",
      "toc",
      "requirement",
      "requirementReport",
      "traceabilityMatrix",
      "baseline",
      "externalIssue",
    ]);
    const disabled = buttons.filter((b) => b.getAttribute("aria-disabled") === "true").map((b) => b.getAttribute("data-macro"));
    expect(disabled).toEqual(["gallery", "requirement", "requirementReport", "traceabilityMatrix", "baseline", "externalIssue"]);
    expect(within(dialog).getAllByText("Not available yet")).toHaveLength(6);
    fireEvent.click(buttons[5] as HTMLElement);
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onChoose).toHaveBeenCalledWith("status");
  });

  it("filters by name, says when nothing matches, and moves with the arrow keys", () => {
    render(<MacroBrowser onChoose={noop} onCancel={noop} />);
    const search = screen.getByRole("searchbox", { name: "Search macros" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "trace" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).getAttribute("data-macro")).toBe("traceabilityMatrix");
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByRole("status").textContent).toBe('No macro is called "zzz".');
  });

  it("Escape closes it", () => {
    const onCancel = vi.fn();
    render(<MacroBrowser onChoose={noop} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("the keyboard shortcuts dialog (RD-057 `?`)", () => {
  it("lists exactly the table, grouped, with the platform's key caps", () => {
    render(<ShortcutsDialog onClose={noop} mac={false} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const rows = Array.from(dialog.querySelectorAll("tr[data-action]")).map((r) => r.getAttribute("data-action"));
    expect(rows).toEqual(SHORTCUTS.map((s) => s.action));
    expect(Array.from(dialog.querySelectorAll("caption")).map((c) => c.textContent)).toEqual([
      "Text formatting",
      "Paragraphs and lists",
      "Editing",
      "Insert and find",
    ]);
    const bold = dialog.querySelector('tr[data-action="bold"]');
    expect(Array.from(bold?.querySelectorAll("kbd") ?? []).map((k) => k.textContent)).toEqual(keyCaps("Mod-b", false));
    expect(bold?.querySelector("th")?.textContent).toBe("Bold");
    const redo = dialog.querySelector('tr[data-action="redo"]');
    expect(redo?.querySelectorAll("kbd")).toHaveLength(5); // Ctrl Shift Z / Ctrl Y
  });

  it("shows ⌘ ⌥ ⇧ on a Mac", () => {
    render(<ShortcutsDialog onClose={noop} mac />);
    const h1 = screen.getByRole("dialog").querySelector('tr[data-action="heading1"]');
    expect(Array.from(h1?.querySelectorAll("kbd") ?? []).map((k) => k.textContent)).toEqual(["⌘", "⌥", "1"]);
  });

  it("closes with its button and with Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} mac={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("the Date dialog", () => {
  it("refuses a value that is not a real date (RD-068), then inserts a real one", () => {
    const onSubmit = vi.fn();
    render(<DateDialog value="2026-10-09" editing={false} onSubmit={onSubmit} onCancel={noop} />);
    expect(screen.getByRole("dialog", { name: "Insert a date" })).toBeTruthy();
    const input = screen.getByLabelText("Date");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a real date.");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2024-02-29" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(onSubmit).toHaveBeenCalledWith("2024-02-29");
  });

  it("editing says Edit date and Done", () => {
    render(<DateDialog value="2026-01-01" editing onSubmit={noop} onCancel={noop} />);
    expect(screen.getByRole("dialog", { name: "Edit date" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});

describe("the Status dialog", () => {
  it("edits the text and the colour; refuses text the schema refuses", () => {
    const onSubmit = vi.fn();
    render(<StatusDialog text="Status" colour="grey" onSubmit={onSubmit} onCancel={noop} />);
    const input = screen.getByRole("textbox", { name: "Text" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter 1 to 60 characters.");
    fireEvent.change(input, { target: { value: "  In  review " } });
    const colours = within(screen.getByRole("group", { name: "Colour" })).getAllByRole("radio");
    expect(colours).toHaveLength(6);
    fireEvent.click(screen.getByRole("radio", { name: "Green" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSubmit).toHaveBeenCalledWith({ text: "In review", colour: "green" });
  });

  it("checkStatusText normalises and bounds the text (RD-068)", () => {
    expect(checkStatusText(" a\n b ")).toBe("a b");
    expect(checkStatusText("\u0000")).toBeNull();
    expect(checkStatusText("x".repeat(80))).toHaveLength(60);
  });
});

describe("the Symbol dialog", () => {
  it("offers a grid of single-character symbols; arrows move, a click picks", () => {
    const onPick = vi.fn();
    render(<SymbolDialog onPick={onPick} onCancel={noop} />);
    const group = screen.getByRole("group", { name: "Insert a symbol" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([...SYMBOLS]);
    expect(new Set(SYMBOLS).size).toBe(SYMBOLS.length);
    for (const s of SYMBOLS) expect([...s]).toHaveLength(1);
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(SYMBOLS[1]);
  });
});

describe("the Markup dialog", () => {
  it("defaults to Markdown, switches to HTML, and says so when nothing can go on the page", () => {
    const onSubmit = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MarkupDialog onSubmit={onSubmit} onCancel={noop} />);
    expect((screen.getByRole("radio", { name: "Markdown" }) as HTMLInputElement).checked).toBe(true);
    const area = screen.getByRole("textbox", { name: "Markdown or HTML to insert" });
    fireEvent.change(area, { target: { value: "<script>x</script>" } });
    fireEvent.click(screen.getByRole("radio", { name: "HTML" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(onSubmit).toHaveBeenLastCalledWith("<script>x</script>", "html");
    expect(screen.getByRole("alert").textContent).toBe("Nothing in this markup can go on the page.");
    fireEvent.change(area, { target: { value: "# ok" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("the User mention dialog", () => {
  const people: UserRef[] = [
    { id: "u1", name: "Alice Admin" },
    { id: "u2", name: "Alan Turing" },
  ];

  it("searches once per pause in typing, cancelling the previous search, then picks with the keyboard", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const search = vi.fn((q: string, signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(q === "" ? people : people.filter((u) => u.name.toLowerCase().startsWith(q.toLowerCase())));
    });
    const onPick = vi.fn();
    render(<MentionDialog search={search} onPick={onPick} onCancel={noop} />);
    const box = screen.getByRole("combobox", { name: "Name" });
    expect(screen.getByRole("status").textContent).toBe("Searching…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MENTION_SEARCH_DEBOUNCE_MS);
    });
    expect(search).toHaveBeenCalledWith("", expect.anything());
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.change(box, { target: { value: "al" } });
    fireEvent.change(box, { target: { value: "ala" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MENTION_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith("ala", expect.anything());
    expect(signals[0]?.aborted).toBe(true);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["ATAlan Turing"]);
    expect(box).toHaveAttribute("aria-activedescendant", options[0]?.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "u2", name: "Alan Turing" });
  });

  it("ArrowDown moves through the results; no match and a failure say so", async () => {
    vi.useFakeTimers();
    let fail = false;
    const search = vi.fn((q: string) => (fail ? Promise.reject(new Error("x")) : Promise.resolve(q === "zz" ? [] : people)));
    const onPick = vi.fn();
    render(<MentionDialog search={search} onPick={onPick} onCancel={noop} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MENTION_SEARCH_DEBOUNCE_MS);
    });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(people[1]);
    fireEvent.change(box, { target: { value: "zz" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MENTION_SEARCH_DEBOUNCE_MS);
    });
    expect(screen.getByRole("status").textContent).toBe('No one\'s name starts with "zz".');
    fail = true;
    fireEvent.change(box, { target: { value: "q" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MENTION_SEARCH_DEBOUNCE_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("Couldn't search for people. Try again.");
  });
});

describe("the find bar (RD-057 `🔍`)", () => {
  function mountBar(content = doc(p(text("Alpha beta alpha")), p(text("ALPHA"))), readOnly = false) {
    const editor = newEditor(content);
    const onClose = vi.fn();
    const ref = { current: null as HTMLInputElement | null };
    render(<FindBar editor={editor} readOnly={readOnly} initialQuery="" queryRef={ref} onClose={onClose} />);
    return { editor, onClose, query: screen.getByRole("searchbox", { name: "Find" }) };
  }

  it("counts matches as the user types, `n of m`, and Match case narrows them", () => {
    const { query } = mountBar();
    fireEvent.change(query, { target: { value: "alpha" } });
    expect(screen.getByTestId("find-count").textContent).toBe("1 of 3");
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    expect(screen.getByTestId("find-count").textContent).toBe("1 of 1");
    fireEvent.change(query, { target: { value: "gamma" } });
    expect(screen.getByTestId("find-count").textContent).toBe("No results");
  });

  it("Enter goes to the next match, Shift+Enter to the previous, and the buttons do the same", () => {
    const { editor, query } = mountBar();
    fireEvent.change(query, { target: { value: "alpha" } });
    fireEvent.keyDown(query, { key: "Enter" });
    expect(screen.getByTestId("find-count").textContent).toBe("2 of 3");
    fireEvent.keyDown(query, { key: "Enter", shiftKey: true });
    expect(screen.getByTestId("find-count").textContent).toBe("1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByTestId("find-count").textContent).toBe("3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(findState(editor.state).current).toBe(0);
  });

  it("Replace and Replace all edit the page through transactions (undoable)", () => {
    const { editor, query } = mountBar();
    fireEvent.change(query, { target: { value: "alpha" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "omega" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(editor.state.doc.textContent).toBe("omega beta alphaALPHA");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(editor.state.doc.textContent).toBe("omega beta omegaomega");
    expect(screen.getByTestId("find-count").textContent).toBe("No results");
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("omega beta alphaALPHA");
  });

  it("cannot replace while the page is read-only", () => {
    mountBar(undefined, true);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find" }), { target: { value: "alpha" } });
    expect((screen.getByRole("button", { name: "Replace all" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Escape closes it; closing clears the highlights", () => {
    const { editor, query, onClose } = mountBar();
    fireEvent.change(query, { target: { value: "beta" } });
    expect(editor.view.dom.querySelectorAll(".rf-find-match")).toHaveLength(1);
    fireEvent.keyDown(query, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    expect(findState(editor.state).query).toBe("");
    expect(editor.view.dom.querySelectorAll(".rf-find-match")).toHaveLength(0);
  });
});

describe("the upload region", () => {
  it("shows uploads in flight and failures, each failure dismissable", () => {
    const onDismiss = vi.fn();
    render(
      <UploadStatus
        uploads={[
          { id: "a", name: "a.png", status: "uploading" },
          { id: "b", name: "b.svg", status: "failed", message: '"b.svg" can\'t be attached: this type of file is not allowed.' },
        ]}
        onDismiss={onDismiss}
      />,
    );
    const region = screen.getByRole("region", { name: "File uploads" });
    expect(within(region).getByText('Uploading "a.png"…')).toBeTruthy();
    expect(within(region).getByRole("progressbar")).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("b");
  });
});
