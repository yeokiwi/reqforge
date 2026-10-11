// @vitest-environment jsdom
// The editor's dropdowns (WAI-ARIA menu button) and its modal dialog: the keyboard contract each
// promises, and the toolbar menus driven through the UI rather than through the commands.
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../dialog";
import { MenuItem, Popover } from "../popover";
import { EditorToolbar, blockStyleLabel, blockStyleTriggerText } from "../toolbar";
import { BLOCK_STYLES, toolbarState } from "../commands";
import { doc, newEditor, p, select, text } from "./editor-harness";

afterEach(cleanup);

function menu(onPick = vi.fn()) {
  render(
    <>
      <Popover kind="menu" label="Choice" valueText="Two">
        <MenuItem role="menuitemradio" checked={false} onSelect={() => onPick("one")}>
          One
        </MenuItem>
        <MenuItem role="menuitemradio" checked onSelect={() => onPick("two")}>
          Two
        </MenuItem>
        <MenuItem role="menuitemradio" checked={false} disabled onSelect={() => onPick("three")}>
          Three
        </MenuItem>
        <MenuItem role="menuitemradio" checked={false} onSelect={() => onPick("four")}>
          Four
        </MenuItem>
      </Popover>
      <button type="button">outside</button>
    </>,
  );
  return { trigger: screen.getByRole("button", { name: "Choice Two" }), onPick };
}

describe("Popover (menu button)", () => {
  it("is named by its label and its visible value, and starts closed", () => {
    const { trigger } = menu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("ArrowDown opens it and focuses the checked item", async () => {
    const { trigger } = menu();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Two" })));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Choice" })).toBeTruthy();
  });

  it("arrow keys skip disabled items and wrap; Home and End jump", async () => {
    const { trigger } = menu();
    fireEvent.click(trigger);
    const panel = screen.getByRole("menu");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Two" })));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Four" }));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "One" }));
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Four" }));
    fireEvent.keyDown(panel, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "One" }));
    fireEvent.keyDown(panel, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Four" }));
  });

  it("Escape closes it and returns focus to the trigger", async () => {
    const { trigger } = menu();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("choosing an item closes it and runs the item; a disabled item does nothing", () => {
    const { trigger, onPick } = menu();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Three" }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "One" }));
    expect(onPick).toHaveBeenCalledWith("one");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a pointer press outside closes it", () => {
    const { trigger } = menu();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a disabled popover does not open", () => {
    render(
      <Popover kind="menu" label="Off" disabled>
        <MenuItem onSelect={() => undefined}>x</MenuItem>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Off" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Dialog", () => {
  it("is modal, named and described, focuses the autofocus control and traps Tab", () => {
    const onDismiss = vi.fn();
    render(
      <>
        <button type="button">before</button>
        <Dialog title="Title" description="Body" onDismiss={onDismiss}>
          <button type="button">first</button>
          <button type="button" data-autofocus="">
            middle
          </button>
          <button type="button">last</button>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole("dialog", { name: "Title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-describedby");
    expect(document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Body");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "middle" }));
    screen.getByRole("button", { name: "last" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "first" }));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "last" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("returns focus to where it was when it closes", () => {
    function Host({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">opener</button>
          {open ? (
            <Dialog title="T" onDismiss={() => undefined}>
              <button type="button">inside</button>
            </Dialog>
          ) : null}
        </>
      );
    }
    const { rerender } = render(<Host open={false} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    rerender(<Host open />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "inside" }));
    rerender(<Host open={false} />);
    expect(document.activeElement).toBe(opener);
  });
});

describe("toolbar menus through the UI", () => {
  function mountToolbar(editor: Editor) {
    const view = render(<EditorToolbar editor={editor} state={toolbarState(editor)} readOnly={false} onOpenLink={() => undefined} />);
    const refresh = () => view.rerender(<EditorToolbar editor={editor} state={toolbarState(editor)} readOnly={false} onOpenLink={() => undefined} />);
    return { refresh };
  }

  it("Paragraph ▾ lists Normal, Heading 1–6, Quote, Preformatted and applies the choice", async () => {
    expect(BLOCK_STYLES.map(blockStyleLabel)).toEqual([
      "Normal",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Quote",
      "Preformatted",
    ]);
    expect(blockStyleTriggerText("normal")).toBe("Paragraph");
    expect(blockStyleTriggerText("h2")).toBe("Heading 2");
    const editor = newEditor(doc(p(text("Title"))));
    select(editor, "Title", true);
    const { refresh } = mountToolbar(editor);
    fireEvent.click(screen.getByRole("button", { name: "Text style Paragraph" }));
    const items = within(screen.getByRole("menu", { name: "Text style" })).getAllByRole("menuitemradio");
    expect(items.map((i) => [i.textContent, i.getAttribute("aria-checked")])[0]).toEqual(["Normal", "true"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Heading 2" }));
    });
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    refresh();
    expect(screen.getByRole("button", { name: "Text style Heading 2" })).toBeTruthy();
  });

  it("A▾ offers the default colour and the palette, and applies one", async () => {
    const editor = newEditor(doc(p(text("red"))));
    select(editor, "red");
    mountToolbar(editor);
    fireEvent.click(screen.getByRole("button", { name: "Text colour" }));
    const items = within(screen.getByRole("menu", { name: "Text colour" })).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Default colour", "Grey", "Dark blue", "Blue", "Green", "Orange", "Red", "Purple"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Red" }));
    });
    expect(JSON.stringify(editor.getJSON())).toContain('"color":"#a11911"');
  });

  it("▦▾ opens the size grid and inserts a table of the picked size", async () => {
    const editor = newEditor(doc(p(text("x"))));
    select(editor, "x", true);
    mountToolbar(editor);
    fireEvent.click(screen.getByRole("button", { name: "Insert table" }));
    const grid = screen.getByRole("dialog", { name: "Insert table" });
    await waitFor(() => expect(document.activeElement).toBe(within(grid).getByRole("button", { name: "Insert a table with 1 columns and 1 rows" })));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(grid).getByRole("button", { name: "Insert a table with 3 columns and 2 rows" }));
    await act(async () => {
      fireEvent.click(document.activeElement as Element);
    });
    const inserted = editor.getJSON().content?.find((n) => n.type === "table");
    expect(inserted?.content).toHaveLength(2);
    expect(inserted?.content?.[0]?.content).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("☺ inserts the chosen emoji as text", async () => {
    const editor = newEditor(doc(p(text("ok"))));
    editor.commands.setTextSelection(3);
    mountToolbar(editor);
    fireEvent.click(screen.getByRole("button", { name: "Emoji" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("group", { name: "Emoji" })).getByRole("button", { name: "✅" }));
    });
    expect(editor.getText()).toBe("ok✅");
  });

  it("read-only (an Update in flight) disables every control", () => {
    const editor = newEditor(doc(p(text("x"))));
    render(<EditorToolbar editor={editor} state={toolbarState(editor)} readOnly onOpenLink={() => undefined} />);
    const buttons = within(screen.getByRole("toolbar")).getAllByRole("button");
    expect(buttons.every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(JSON.stringify(editor.getJSON())).not.toContain('"bold"');
  });
});

describe("Dialog focus fallback (pass 2)", () => {
  it("returns focus to the control that had it; when that control is gone, calls fallbackFocus", () => {
    const fallback = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const first = render(
      <Dialog title="T" onDismiss={() => undefined} fallbackFocus={fallback}>
        <button type="button">in</button>
      </Dialog>,
    );
    first.unmount();
    expect(document.activeElement).toBe(opener);
    expect(fallback).not.toHaveBeenCalled();
    opener.focus();
    const second = render(
      <Dialog title="T" onDismiss={() => undefined} fallbackFocus={fallback}>
        <button type="button">in</button>
      </Dialog>,
    );
    opener.remove(); // a menu item that opened the dialog and then went away
    second.unmount();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
