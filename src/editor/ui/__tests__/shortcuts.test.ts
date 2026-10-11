// @vitest-environment jsdom
// The keyboard shortcuts are ONE table (shortcuts.ts) read by the editor's keymap, the window's
// save binding and the `?` dialog (RD-057). These tests hold the table to that: every key it
// shows is bound and does what it says; no schema extension binds a modifier key it does not
// list; no two entries claim one key; the labels and key caps come from the copy deck.
import { type AnyExtension, type Editor, getExtensionField } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { shortcutsExtension } from "../extensions";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  STRUCTURAL_KEYS,
  type Shortcut,
  isMacPlatform,
  keyCaps,
  matchesShortcut,
  normalizeKey,
  parseKey,
  shortcutBindings,
  shortcutCommand,
  shortcutFor,
  shortcutLabel,
} from "../shortcuts";
import { EditorUiBridge } from "../ui-bridge";
import { isSaveShortcut } from "../use-autosave";
import { doc, newEditor, p, select, text } from "./editor-harness";

/** Presses `notation` in the editor the way a keyboard would (a keydown on its DOM). */
function press(editor: Editor, notation: string): boolean {
  const { modifiers, key } = parseKey(notation);
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: modifiers.includes("Mod") || modifiers.includes("Ctrl"),
    metaKey: modifiers.includes("Meta") || modifiers.includes("Cmd"),
    altKey: modifiers.includes("Alt"),
    shiftKey: modifiers.includes("Shift"),
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

const MODIFIER = /(^|-)(Mod|Ctrl|Alt|Meta|Cmd)-/;

describe("the shortcuts table", () => {
  it("lists every group in order, each non-empty, with labels from the copy deck", () => {
    expect(SHORTCUT_GROUPS).toEqual(["formatting", "paragraph", "editing", "insert"]);
    for (const group of SHORTCUT_GROUPS) expect(SHORTCUTS.some((s) => s.group === group)).toBe(true);
    for (const shortcut of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(shortcut.group);
      expect(shortcutLabel(shortcut).length).toBeGreaterThan(0);
      expect(shortcut.keys.length).toBeGreaterThan(0);
    }
    expect(shortcutLabel(shortcutFor("heading2"))).toBe("Heading 2");
    expect(shortcutLabel(shortcutFor("macroSuggestions"))).toBe(t("autocomplete.title"));
  });

  it("never binds one key twice, aliases included", () => {
    const seen = new Map<string, string>();
    for (const shortcut of SHORTCUTS) {
      for (const key of [...shortcut.keys, ...(shortcut.aliases ?? [])]) {
        const normal = normalizeKey(key);
        expect(seen.get(normal), `${key} is claimed by ${seen.get(normal)} and ${shortcut.action}`).toBeUndefined();
        seen.set(normal, shortcut.action);
      }
    }
  });

  it("gives every editor shortcut a command, and builds a keymap from them", () => {
    for (const shortcut of SHORTCUTS.filter((s) => s.binding === "editor")) {
      expect(shortcutCommand(shortcut.action), shortcut.action).not.toBeNull();
    }
    const editor = newEditor();
    const bindings = shortcutBindings(editor, new EditorUiBridge());
    const expected = SHORTCUTS.filter((s) => s.binding === "editor").flatMap((s) => [...s.keys, ...(s.aliases ?? [])]);
    expect(Object.keys(bindings).sort()).toEqual([...expected].sort());
  });

  it("refuses a table in which two entries claim one key", () => {
    const editor = newEditor();
    const twice: Shortcut[] = [shortcutFor("bold"), { ...shortcutFor("italic"), keys: ["Mod-B"] }];
    expect(() => shortcutBindings(editor, new EditorUiBridge(), twice)).toThrow(/two shortcuts bind/);
  });

  it("does not bind Alt+Shift+R: it belongs to the Requirement macro (10 §5.3, slice 2)", () => {
    const all = SHORTCUTS.flatMap((s) => [...s.keys, ...(s.aliases ?? [])]).map(normalizeKey);
    expect(all).not.toContain(normalizeKey("Alt-Shift-r"));
  });
});

describe("key notation and key caps", () => {
  it("parses and normalises ProseMirror notation", () => {
    expect(parseKey("Mod-Shift-8")).toEqual({ modifiers: ["Mod", "Shift"], key: "8" });
    expect(parseKey("Mod--")).toEqual({ modifiers: ["Mod"], key: "-" });
    expect(normalizeKey("Shift-Mod-z")).toBe(normalizeKey("Mod-Shift-z"));
  });

  it("shows Ctrl, Alt and Shift on Windows and Linux, ⌘ ⌥ ⇧ on a Mac", () => {
    expect(keyCaps("Mod-Alt-1", false)).toEqual(["Ctrl", "Alt", "1"]);
    expect(keyCaps("Mod-Alt-1", true)).toEqual(["⌘", "⌥", "1"]);
    expect(keyCaps("Mod-Shift-z", true)).toEqual(["⌘", "⇧", "Z"]);
    expect(keyCaps("Shift-Enter", false)).toEqual(["Shift", "Enter"]);
    expect(keyCaps("Shift-Tab", false)).toEqual(["Shift", "Tab"]);
    expect(keyCaps("{", false)).toEqual(["{"]);
  });

  it("detects a Mac as ProseMirror does", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "iPhone" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });

  it("matches window key events, Mod being ⌘ on a Mac and Ctrl elsewhere", () => {
    const ev = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(matchesShortcut(ev("f", { ctrlKey: true }), "Mod-f", { mac: false })).toBe(true);
    expect(matchesShortcut(ev("f", { metaKey: true }), "Mod-f", { mac: false })).toBe(false);
    expect(matchesShortcut(ev("f", { metaKey: true }), "Mod-f", { mac: true })).toBe(true);
    expect(matchesShortcut(ev("F", { ctrlKey: true, shiftKey: true }), "Mod-f", { mac: false })).toBe(false);
    expect(matchesShortcut(ev("s", { metaKey: true }), "Mod-s", { mac: false, modEither: true })).toBe(true);
  });

  it("the window's save binding is the table's `save` entry (RD-055)", () => {
    expect(shortcutFor("save").binding).toBe("window");
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "s", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(false);
  });
});

describe("the bindings in a real editor", () => {
  it("every formatting and paragraph shortcut the dialog shows does what it says", () => {
    const cases: Array<[string, (e: Editor) => boolean]> = [
      ["bold", (e) => e.isActive("bold")],
      ["italic", (e) => e.isActive("italic")],
      ["underline", (e) => e.isActive("underline")],
      ["strike", (e) => e.isActive("strike")],
      ["code", (e) => e.isActive("code")],
      ["subscript", (e) => e.isActive("subscript")],
      ["superscript", (e) => e.isActive("superscript")],
      ["heading1", (e) => e.isActive("heading", { level: 1 })],
      ["heading6", (e) => e.isActive("heading", { level: 6 })],
      ["quote", (e) => e.isActive("blockquote")],
      ["preformatted", (e) => e.isActive("codeBlock")],
      ["bulletList", (e) => e.isActive("bulletList")],
      ["orderedList", (e) => e.isActive("orderedList")],
      ["taskList", (e) => e.isActive("taskList")],
      ["alignCentre", (e) => e.state.selection.$from.parent.attrs.textAlign === "center"],
      ["alignRight", (e) => e.state.selection.$from.parent.attrs.textAlign === "right"],
    ];
    for (const [action, isOn] of cases) {
      const editor = newEditor(doc(p(text("hello"))));
      select(editor, "hello");
      const key = shortcutFor(action as Shortcut["action"]).keys[0] as string;
      expect(press(editor, key), `${action} (${key}) was not handled`).toBe(true);
      expect(isOn(editor), `${action} (${key}) did not apply`).toBe(true);
    }
  });

  it("Align left returns to the default (stored as null), like the toolbar", () => {
    const editor = newEditor(doc(p(text("hello"))));
    select(editor, "hello");
    press(editor, shortcutFor("alignRight").keys[0] as string);
    press(editor, shortcutFor("alignLeft").keys[0] as string);
    expect(editor.state.selection.$from.parent.attrs.textAlign).toBeNull();
  });

  it("Mod-Shift-j (justify) is not bound: the toolbar offers three alignments (RD-057)", () => {
    const editor = newEditor(doc(p(text("hello"))));
    select(editor, "hello");
    press(editor, "Mod-Shift-j");
    expect(editor.state.selection.$from.parent.attrs.textAlign).toBeNull();
  });

  it("undo and redo are bound to every key the table lists", () => {
    const editor = newEditor(doc(p(text("hello"))));
    select(editor, "hello");
    editor.commands.toggleBold();
    expect(press(editor, "Mod-z")).toBe(true);
    expect(editor.isActive("bold")).toBe(false);
    expect(press(editor, "Mod-y")).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
    press(editor, "Mod-z");
    expect(press(editor, "Mod-Shift-z")).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
  });

  it("Mod-k, Mod-f and Mod-/ ask the UI for the link dialog, the find bar and this list", () => {
    const ui = new EditorUiBridge();
    const handlers = { openLink: vi.fn(), openFind: vi.fn(), openShortcuts: vi.fn() };
    ui.setHandlers(handlers);
    const editor = newEditor(doc(p(text("hello"))), ui);
    expect(press(editor, "Mod-k")).toBe(true);
    expect(press(editor, "Mod-f")).toBe(true);
    expect(press(editor, "Mod-/")).toBe(true);
    expect(handlers.openLink).toHaveBeenCalledTimes(1);
    expect(handlers.openFind).toHaveBeenCalledTimes(1);
    expect(handlers.openShortcuts).toHaveBeenCalledTimes(1);
  });

  it("without a UI (headless), those keys fall through rather than being swallowed", () => {
    const editor = newEditor(doc(p(text("hello"))));
    expect(press(editor, "Mod-f")).toBe(false);
  });

  it("Enter on a selected status or date asks for its editor; elsewhere Enter splits as usual", () => {
    const ui = new EditorUiBridge();
    const editNode = vi.fn();
    ui.setHandlers({ editNode });
    const editor = newEditor(doc(p(text("a"), { type: "status", attrs: { text: "Done", colour: "green" } }, text("b"))), ui);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2)));
    expect(press(editor, "Enter")).toBe(true);
    expect(editNode).toHaveBeenCalledWith({ kind: "status", pos: 2 });
    editor.commands.setTextSelection(2);
    press(editor, "Enter");
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("every `schema` entry is really bound by a schema extension", () => {
    const editor = newEditor();
    const bound = schemaBoundKeys(editor);
    for (const shortcut of SHORTCUTS.filter((s) => s.binding === "schema")) {
      for (const key of shortcut.keys) expect(bound.has(normalizeKey(key)), `${shortcut.action}: ${key}`).toBe(true);
    }
  });

  it("no extension binds a modifier shortcut the table does not list (so the dialog misses none)", () => {
    const editor = newEditor();
    const listed = new Set(SHORTCUTS.flatMap((s) => [...s.keys, ...(s.aliases ?? [])]).map(normalizeKey));
    const structural = new Set(STRUCTURAL_KEYS.map(normalizeKey));
    const unlisted = [...schemaBoundKeys(editor)].filter((key) => MODIFIER.test(`${key}-`) && !listed.has(key) && !structural.has(key));
    expect(unlisted).toEqual([]);
  });

  it("the rfShortcuts keymap runs before the schema extensions' own", () => {
    const extension = shortcutsExtension(new EditorUiBridge());
    expect(extension.config.priority ?? 100).toBeGreaterThan(100);
  });
});

/** Every key some extension other than ours binds through addKeyboardShortcuts, normalised. */
function schemaBoundKeys(editor: Editor): Set<string> {
  const keys = new Set<string>();
  for (const extension of editor.extensionManager.extensions as AnyExtension[]) {
    if (extension.name === "rfShortcuts") continue;
    const add = getExtensionField<(() => Record<string, unknown>) | undefined>(extension, "addKeyboardShortcuts", {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
      editor,
      type: editor.schema.nodes[extension.name] ?? editor.schema.marks[extension.name],
    });
    if (!add) continue;
    for (const key of Object.keys(add())) keys.add(normalizeKey(key));
  }
  return keys;
}
