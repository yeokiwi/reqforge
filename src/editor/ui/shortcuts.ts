// The editor's keyboard shortcuts: ONE table, read by the key bindings and by the `?` Keyboard
// shortcuts dialog, so the dialog cannot list a key the editor does not honour or miss one it
// does. Each entry says who binds it:
//   editor  — the `rfShortcuts` keymap built from this table (shortcutBindings below);
//   schema  — a schema extension's own structural binding (Tab in a list, Shift+Enter), listed
//             so users can find it; a test checks the extension really binds it;
//   window  — bound on the window by the autosave hook (Ctrl/Cmd+S, RD-055), through
//             matchesShortcut, from this table;
//   typed   — a character typed into the text: `{` opens Macro suggestions (10 §5.4).
// The schema extensions' own modifier shortcuts duplicate entries of this table (same key, same
// command), and a test fails if any of them binds a modifier key this table does not list.
// Alt+Shift+R is not here: it belongs to the requirement macro (slice 2, 10 §5.3).
// spec: docs/specs/10-ui-reference.md sections 5.1 (`?`) and 5.4 (`{`); docs/specs/09-decision-log.md section RD-057
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { type ParamlessCopyId, t } from "@/copy";
import { setAlignment } from "./commands";
import type { EditorUiBridge } from "./ui-bridge";

/** Typing this opens Macro suggestions (10 §5.4). */
export const MACRO_TRIGGER = "{";

export type ShortcutGroup = "formatting" | "paragraph" | "editing" | "insert";
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = Object.freeze(["formatting", "paragraph", "editing", "insert"]);

export const SHORTCUT_GROUP_COPY: Readonly<Record<ShortcutGroup, ParamlessCopyId>> = Object.freeze({
  formatting: "editor.shortcuts.group.formatting",
  paragraph: "editor.shortcuts.group.paragraph",
  editing: "editor.shortcuts.group.editing",
  insert: "editor.shortcuts.group.insert",
});

export type ShortcutBinding = "editor" | "schema" | "window" | "typed";

export type ShortcutAction =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "subscript"
  | "superscript"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "quote"
  | "preformatted"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "indent"
  | "outdent"
  | "alignLeft"
  | "alignCentre"
  | "alignRight"
  | "undo"
  | "redo"
  | "lineBreak"
  | "editNode"
  | "save"
  | "link"
  | "find"
  | "macroSuggestions"
  | "shortcuts";

export type ShortcutLabel =
  | { readonly id: ParamlessCopyId }
  | { readonly id: "editor.style.heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6 };

export interface Shortcut {
  readonly action: ShortcutAction;
  readonly group: ShortcutGroup;
  readonly binding: ShortcutBinding;
  /** ProseMirror key notation (`Mod-Shift-8`); every one is bound and shown. */
  readonly keys: readonly string[];
  /** Bound but not shown: the same key on another keyboard state or layout (`Mod-B`, `Mod-я`). */
  readonly aliases?: readonly string[];
  readonly label: ShortcutLabel;
}

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): Shortcut => ({
  action: `heading${level}`,
  group: "paragraph",
  binding: "editor",
  keys: [`Mod-Alt-${level}`],
  label: { id: "editor.style.heading", level },
});

/**
 * Every shortcut, in the order the dialog lists them. The keys are TipTap's defaults for the
 * same commands, so muscle memory from other TipTap editors carries over; the ones that are ours
 * are `Mod-k` (link dialog), `Mod-f` (find, RD-057), `Mod-/` (this list) and Enter on a selected
 * status or date.
 */
// spec: docs/specs/10-ui-reference.md section 5.1 (`?` keyboard shortcuts); RD-057
export const SHORTCUTS: readonly Shortcut[] = Object.freeze([
  { action: "bold", group: "formatting", binding: "editor", keys: ["Mod-b"], aliases: ["Mod-B"], label: { id: "editor.bold" } },
  { action: "italic", group: "formatting", binding: "editor", keys: ["Mod-i"], aliases: ["Mod-I"], label: { id: "editor.italic" } },
  { action: "underline", group: "formatting", binding: "editor", keys: ["Mod-u"], aliases: ["Mod-U"], label: { id: "editor.underline" } },
  { action: "strike", group: "formatting", binding: "editor", keys: ["Mod-Shift-s"], label: { id: "editor.strike" } },
  { action: "code", group: "formatting", binding: "editor", keys: ["Mod-e"], label: { id: "editor.code" } },
  { action: "subscript", group: "formatting", binding: "editor", keys: ["Mod-,"], label: { id: "editor.subscript" } },
  { action: "superscript", group: "formatting", binding: "editor", keys: ["Mod-."], label: { id: "editor.superscript" } },

  { action: "paragraph", group: "paragraph", binding: "editor", keys: ["Mod-Alt-0"], label: { id: "editor.style.normal" } },
  heading(1),
  heading(2),
  heading(3),
  heading(4),
  heading(5),
  heading(6),
  { action: "quote", group: "paragraph", binding: "editor", keys: ["Mod-Shift-b"], label: { id: "editor.style.quote" } },
  { action: "preformatted", group: "paragraph", binding: "editor", keys: ["Mod-Alt-c"], label: { id: "editor.style.preformatted" } },
  { action: "bulletList", group: "paragraph", binding: "editor", keys: ["Mod-Shift-8"], label: { id: "editor.bulletList" } },
  { action: "orderedList", group: "paragraph", binding: "editor", keys: ["Mod-Shift-7"], label: { id: "editor.orderedList" } },
  { action: "taskList", group: "paragraph", binding: "editor", keys: ["Mod-Shift-9"], label: { id: "editor.taskList" } },
  { action: "indent", group: "paragraph", binding: "schema", keys: ["Tab"], label: { id: "editor.indent" } },
  { action: "outdent", group: "paragraph", binding: "schema", keys: ["Shift-Tab"], label: { id: "editor.outdent" } },
  { action: "alignLeft", group: "paragraph", binding: "editor", keys: ["Mod-Shift-l"], label: { id: "editor.alignLeft" } },
  { action: "alignCentre", group: "paragraph", binding: "editor", keys: ["Mod-Shift-e"], label: { id: "editor.alignCentre" } },
  { action: "alignRight", group: "paragraph", binding: "editor", keys: ["Mod-Shift-r"], label: { id: "editor.alignRight" } },

  { action: "undo", group: "editing", binding: "editor", keys: ["Mod-z"], aliases: ["Mod-я"], label: { id: "editor.undo" } },
  { action: "redo", group: "editing", binding: "editor", keys: ["Mod-Shift-z", "Mod-y"], aliases: ["Mod-Shift-я"], label: { id: "editor.redo" } },
  { action: "lineBreak", group: "editing", binding: "schema", keys: ["Shift-Enter"], label: { id: "editor.shortcuts.lineBreak" } },
  { action: "editNode", group: "editing", binding: "editor", keys: ["Enter"], label: { id: "editor.shortcuts.editNode" } },
  { action: "save", group: "editing", binding: "window", keys: ["Mod-s"], label: { id: "editor.shortcuts.save" } },

  { action: "link", group: "insert", binding: "editor", keys: ["Mod-k"], label: { id: "editor.link" } },
  { action: "macroSuggestions", group: "insert", binding: "typed", keys: [MACRO_TRIGGER], label: { id: "autocomplete.title" } },
  { action: "find", group: "insert", binding: "editor", keys: ["Mod-f"], label: { id: "editor.find" } },
  { action: "shortcuts", group: "insert", binding: "editor", keys: ["Mod-/"], label: { id: "editor.help" } },
] satisfies Shortcut[]);

/**
 * Keys the schema extensions bind for editing structure rather than as shortcuts (Enter splits,
 * Backspace joins, Mod-a selects all, Mod-Enter leaves a code block): not listed in the dialog.
 */
export const STRUCTURAL_KEYS: readonly string[] = Object.freeze([
  "Enter",
  "Backspace",
  "Delete",
  "ArrowDown",
  "Shift-Backspace",
  "Mod-Backspace",
  "Mod-Delete",
  "Mod-Enter",
  "Mod-a",
]);

export function shortcutFor(action: ShortcutAction): Shortcut {
  const found = SHORTCUTS.find((s) => s.action === action);
  if (!found) throw new RangeError(`no shortcut for ${action}`);
  return found;
}

/** The label of a shortcut, from the copy deck. */
export function shortcutLabel(shortcut: Shortcut): string {
  const label = shortcut.label;
  return "level" in label ? t("editor.style.heading", { level: label.level }) : t(label.id);
}

// ------------------------------------------------------------------------------ key notation

const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift", "Meta", "Cmd"] as const;
type Modifier = (typeof MODIFIERS)[number];

function isModifier(part: string): part is Modifier {
  return (MODIFIERS as readonly string[]).includes(part);
}

/** `Mod-Shift-8` → modifiers and the key. A trailing `-` is the minus key. */
export function parseKey(notation: string): { readonly modifiers: readonly Modifier[]; readonly key: string } {
  const parts = notation.split(/-(?!$)/);
  const key = parts.pop() ?? "";
  return { modifiers: parts.filter(isModifier), key };
}

/** A notation with its modifiers in a fixed order, so `Shift-Mod-z` and `Mod-Shift-z` compare equal. */
export function normalizeKey(notation: string): string {
  const { modifiers, key } = parseKey(notation);
  const order: readonly Modifier[] = ["Mod", "Cmd", "Meta", "Ctrl", "Alt", "Shift"];
  const sorted = [...new Set(modifiers)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...sorted, key].join("-");
}

/** Whether the platform is a Mac, as ProseMirror's keymap decides it (`Mod` is ⌘ there). */
export function isMacPlatform(nav: { readonly platform?: string } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return nav ? /Mac|iP(hone|[oa]d)/.test(nav.platform ?? "") : false;
}

/** The key caps a notation shows as: `Mod-Shift-8` → [Ctrl, Shift, 8], or [⌘, ⇧, 8] on a Mac. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`?` keyboard shortcuts)
export function keyCaps(notation: string, mac: boolean): string[] {
  const { modifiers, key } = parseKey(notation);
  const caps = modifiers.map((m) => {
    switch (m) {
      case "Mod":
        return mac ? t("editor.key.macCmd") : t("editor.key.ctrl");
      case "Cmd":
      case "Meta":
        return t("editor.key.macCmd");
      case "Ctrl":
        return t("editor.key.ctrl");
      case "Alt":
        return mac ? t("editor.key.macOption") : t("editor.key.alt");
      case "Shift":
        return mac ? t("editor.key.macShift") : t("editor.key.shift");
    }
  });
  let cap: string;
  if (key === "Enter") cap = t("editor.key.enter");
  else if (key === "Tab") cap = t("editor.key.tab");
  else cap = key.length === 1 ? key.toUpperCase() : key;
  return [...caps, cap];
}

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Whether a window key event is the shortcut `notation`. `modEither` lets `Mod` be Ctrl or ⌘ on
 * any platform (Save does, RD-055); otherwise `Mod` is ⌘ on a Mac and Ctrl elsewhere.
 */
export function matchesShortcut(event: KeyEventLike, notation: string, options: { mac?: boolean; modEither?: boolean } = {}): boolean {
  const mac = options.mac ?? isMacPlatform();
  const { modifiers, key } = parseKey(notation);
  const want = new Set(modifiers);
  const mod = want.has("Mod");
  if (event.altKey !== want.has("Alt")) return false;
  if (event.shiftKey !== want.has("Shift")) return false;
  if (mod && options.modEither) {
    if (!event.ctrlKey && !event.metaKey) return false;
  } else {
    const ctrl = want.has("Ctrl") || (mod && !mac);
    const meta = want.has("Meta") || want.has("Cmd") || (mod && mac);
    if (event.ctrlKey !== ctrl || event.metaKey !== meta) return false;
  }
  return event.key.toLowerCase() === key.toLowerCase();
}

// ------------------------------------------------------------------------------- the keymap

type Command = (editor: Editor, ui: EditorUiBridge) => boolean;

function editSelectedNode(editor: Editor, ui: EditorUiBridge): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return false;
  const name = selection.node.type.name;
  if (name !== "status" && name !== "date") return false;
  return ui.call("editNode", { kind: name, pos: selection.from });
}

const EDITOR_COMMANDS: Readonly<Partial<Record<ShortcutAction, Command>>> = {
  bold: (e) => e.commands.toggleBold(),
  italic: (e) => e.commands.toggleItalic(),
  underline: (e) => e.commands.toggleUnderline(),
  strike: (e) => e.commands.toggleStrike(),
  code: (e) => e.commands.toggleCode(),
  subscript: (e) => e.commands.toggleSubscript(),
  superscript: (e) => e.commands.toggleSuperscript(),
  paragraph: (e) => e.commands.setParagraph(),
  heading1: (e) => e.commands.toggleHeading({ level: 1 }),
  heading2: (e) => e.commands.toggleHeading({ level: 2 }),
  heading3: (e) => e.commands.toggleHeading({ level: 3 }),
  heading4: (e) => e.commands.toggleHeading({ level: 4 }),
  heading5: (e) => e.commands.toggleHeading({ level: 5 }),
  heading6: (e) => e.commands.toggleHeading({ level: 6 }),
  quote: (e) => e.commands.toggleBlockquote(),
  preformatted: (e) => e.commands.toggleCodeBlock(),
  bulletList: (e) => e.commands.toggleBulletList(),
  orderedList: (e) => e.commands.toggleOrderedList(),
  taskList: (e) => e.commands.toggleTaskList(),
  alignLeft: (e) => setAlignment(e, "left"),
  alignCentre: (e) => setAlignment(e, "center"),
  alignRight: (e) => setAlignment(e, "right"),
  undo: (e) => e.commands.undo(),
  redo: (e) => e.commands.redo(),
  editNode: editSelectedNode,
  link: (_e, ui) => ui.call("openLink"),
  find: (_e, ui) => ui.call("openFind"),
  shortcuts: (_e, ui) => ui.call("openShortcuts"),
};

/** The command an `editor` shortcut runs, or null for the other bindings. */
export function shortcutCommand(action: ShortcutAction): Command | null {
  return EDITOR_COMMANDS[action] ?? null;
}

/**
 * The bindings of the `rfShortcuts` keymap: every key and alias of every `editor` entry. Throws
 * if two entries claim one key (a test builds it, so that cannot ship).
 */
// spec: docs/specs/10-ui-reference.md section 5.1 (`?`: the dialog and the bindings are one table)
export function shortcutBindings(editor: Editor, ui: EditorUiBridge, table: readonly Shortcut[] = SHORTCUTS): Record<string, () => boolean> {
  const bindings: Record<string, () => boolean> = {};
  const seen = new Set<string>();
  for (const shortcut of table) {
    if (shortcut.binding !== "editor") continue;
    const command = shortcutCommand(shortcut.action);
    if (!command) throw new RangeError(`no command for the editor shortcut ${shortcut.action}`);
    for (const key of [...shortcut.keys, ...(shortcut.aliases ?? [])]) {
      const normal = normalizeKey(key);
      if (seen.has(normal)) throw new RangeError(`two shortcuts bind ${key}`);
      seen.add(normal);
      bindings[key] = () => command(editor, ui);
    }
  }
  return bindings;
}
