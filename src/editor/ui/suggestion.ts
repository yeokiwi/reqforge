// The `{` Macro suggestions list (10 §5.4), as a TipTap Suggestion plugin plus a small external
// store the React list reads. Typing `{` (at the start of a text or after a space, outside code)
// opens the list titled `Macro suggestions` with, in the drawn order, Info · Status · Gallery ·
// Table of Contents · Requirement · Open macro browser; Gallery and Requirement are drawn
// disabled (later, slice 2). Typing on filters by name. ArrowDown and ArrowUp move between the
// enabled items (wrapping), Enter chooses, Escape closes the list and leaves the typed text alone.
// Choosing a macro deletes the `{query` text and inserts the macro in ONE transaction (one undo
// step, insert-commands.ts); choosing `Open macro browser` deletes it and opens the browser.
// The order follows recency once something has been inserted (macros.ts keeps the recents per
// browser, and survives a storage that throws).
//
// The list is a listbox the editor's text box points at with aria-controls and
// aria-activedescendant, so a screen reader announces the highlighted item while focus stays in
// the text.
// spec: docs/specs/10-ui-reference.md section 5.4 (`{` Macro suggestions); 5.3 (`{requirement`)
import { type Editor, Extension, type Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { insertMacro } from "./insert-commands";
import { type SuggestionItem, browserStorage, loadRecentMacros, macroSuggestions } from "./macros";
import { MACRO_TRIGGER } from "./shortcuts";
import type { EditorUiBridge } from "./ui-bridge";

export interface SuggestionAnchor {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface SuggestionSnapshot {
  /** The list is showing (there is something to show, and Escape has not closed it). */
  readonly open: boolean;
  readonly query: string;
  readonly items: readonly SuggestionItem[];
  /** Index of the highlighted item, or -1. */
  readonly active: number;
  /** Where the `{query` text is on screen (viewport coordinates), when known. */
  readonly anchor: SuggestionAnchor | null;
}

export const CLOSED_SUGGESTIONS: SuggestionSnapshot = Object.freeze({ open: false, query: "", items: [], active: -1, anchor: null });

/** The first enabled item at or after `from` going in `step`, wrapping; -1 when none is enabled. */
// spec: docs/specs/10-ui-reference.md section 5.4 (arrow keys move between the items)
export function nextEnabledIndex(items: readonly SuggestionItem[], from: number, step: 1 | -1): number {
  const n = items.length;
  for (let i = 0; i < n; i++) {
    const index = (((from + step * i) % n) + n) % n;
    if (items[index] && !items[index].disabled) return index;
  }
  return -1;
}

let controllerCount = 0;

/**
 * The list's state, shared by the plugin (which opens, updates and closes it) and the React list
 * (which renders it and chooses with the mouse). React reads it with useSyncExternalStore.
 */
export class MacroSuggestionController {
  /** Prefix of the listbox's and options' DOM ids. */
  readonly id = `rf-macro-suggestions-${++controllerCount}`;
  private snapshot: SuggestionSnapshot = CLOSED_SUGGESTIONS;
  private readonly listeners = new Set<() => void>();
  private choose: ((item: SuggestionItem) => void) | null = null;
  /** Where the `{query` Escape closed starts; the list stays closed until a `{` elsewhere. */
  private dismissedAt: number | null = null;
  /** Where the current `{query` starts. */
  private rangeFrom = 0;
  private dom: HTMLElement | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SuggestionSnapshot => this.snapshot;

  optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  /** The plugin found (or updated) a `{query` at `range`. */
  show(props: Pick<SuggestionProps<SuggestionItem, SuggestionItem>, "items" | "query" | "range" | "command" | "clientRect" | "editor">): void {
    this.choose = (item) => props.command(item);
    this.dom = props.editor.view.dom;
    if (this.dismissedAt !== null && this.dismissedAt !== props.range.from) this.dismissedAt = null;
    const items = props.items;
    const previous = this.snapshot.items[this.snapshot.active];
    const kept = previous ? items.findIndex((item) => item.label === previous.label && !item.disabled) : -1;
    const active = kept >= 0 ? kept : nextEnabledIndex(items, 0, 1);
    const rect = props.clientRect?.() ?? null;
    this.set({
      open: items.length > 0 && this.dismissedAt === null,
      query: props.query,
      items,
      active,
      anchor: rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null,
    });
    this.rangeFrom = props.range.from;
  }

  /** The `{query` is gone (deleted, the caret left it, or a macro was chosen). */
  hide(): void {
    this.choose = null;
    this.dismissedAt = null;
    this.set(CLOSED_SUGGESTIONS);
  }

  /** Escape: close the list; the text stays, and the list stays closed until a new `{`. */
  dismiss(): void {
    this.dismissedAt = this.rangeFrom;
    this.set({ ...this.snapshot, open: false });
  }

  setActive(index: number): void {
    const item = this.snapshot.items[index];
    if (!item || item.disabled || index === this.snapshot.active) return;
    this.set({ ...this.snapshot, active: index });
  }

  /** Chooses the item at `index` (the highlighted one by default). Disabled items do nothing. */
  chooseItem(index: number = this.snapshot.active): boolean {
    const item = this.snapshot.items[index];
    if (!this.snapshot.open || !item || item.disabled || !this.choose) return false;
    this.choose(item);
    return true;
  }

  /** Keys while the list is showing: arrows move, Enter chooses, Escape closes. */
  // spec: docs/specs/10-ui-reference.md section 5.4
  handleKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing">): boolean {
    if (!this.snapshot.open || event.isComposing) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    const { items, active } = this.snapshot;
    switch (event.key) {
      case "ArrowDown": {
        const next = nextEnabledIndex(items, active + 1, 1);
        if (next >= 0) this.set({ ...this.snapshot, active: next });
        return true;
      }
      case "ArrowUp": {
        const next = nextEnabledIndex(items, active - 1, -1);
        if (next >= 0) this.set({ ...this.snapshot, active: next });
        return true;
      }
      case "Enter":
        if (event.shiftKey) return false;
        return this.chooseItem();
      case "Escape":
        this.dismiss();
        return true;
      default:
        return false;
    }
  }

  private set(next: SuggestionSnapshot): void {
    this.snapshot = next;
    this.syncAria();
    for (const listener of this.listeners) listener();
  }

  /** Points the editor's text box at the list while it shows. */
  private syncAria(): void {
    const dom = this.dom;
    if (!dom) return;
    if (this.snapshot.open) {
      dom.setAttribute("aria-autocomplete", "list");
      dom.setAttribute("aria-controls", this.id);
      if (this.snapshot.active >= 0) dom.setAttribute("aria-activedescendant", this.optionId(this.snapshot.active));
      else dom.removeAttribute("aria-activedescendant");
    } else {
      dom.removeAttribute("aria-autocomplete");
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }
}

/** Whether `{` may open the list here: not inside a code block or inline code. */
export function allowsMacroSuggestions(state: EditorState, range: Range): boolean {
  const $from = state.doc.resolve(range.from);
  if ($from.parent.type.spec.code) return false;
  return !$from.marks().some((mark) => mark.type.spec.code === true || mark.type.name === "code");
}

export const macroSuggestionKey = new PluginKey("rfMacroSuggestions");

/** What choosing an item does. Exported for tests. */
// spec: docs/specs/10-ui-reference.md sections 5.4 (`{` Macro suggestions) and 5.5 (Other macros → the macro browser)
export function runSuggestion(editor: Editor, range: Range, item: SuggestionItem, ui: EditorUiBridge): boolean {
  if (item.disabled) return false;
  if (item.kind === "browser") {
    const ok = editor.chain().focus().deleteRange(range).run();
    if (ok) ui.call("openMacroBrowser");
    return ok;
  }
  return insertMacro(editor, item.id, { range, ui });
}

/**
 * The extension. It needs the bridge's controller; without one (a bridge built for a headless
 * test) it adds nothing.
 */
// spec: docs/specs/10-ui-reference.md section 5.4
export function macroSuggestionsExtension(ui: EditorUiBridge): Extension {
  return Extension.create({
    name: "rfMacroSuggestions",
    // Above every keymap: while the list shows, Enter and the arrows are the list's.
    priority: 1100,
    addProseMirrorPlugins() {
      const controller = ui.suggestions;
      if (!controller) return [];
      return [
        Suggestion<SuggestionItem, SuggestionItem>({
          pluginKey: macroSuggestionKey,
          editor: this.editor,
          char: MACRO_TRIGGER,
          // Names have spaces ("Table of Contents"); when nothing matches the list is empty and
          // closes, so a brace in prose (`{a, b}`) is left alone.
          allowSpaces: true,
          decorationClass: "rf-macro-query",
          allow: ({ state, range }) => allowsMacroSuggestions(state, range),
          items: ({ query }) => macroSuggestions(query, loadRecentMacros(browserStorage())),
          command: ({ editor, range, props }) => {
            runSuggestion(editor, range, props, ui);
          },
          render: () => ({
            onStart: (props) => controller.show(props),
            onUpdate: (props) => controller.show(props),
            onExit: () => controller.hide(),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => controller.handleKey(event),
          }),
        }),
      ];
    },
  });
}
