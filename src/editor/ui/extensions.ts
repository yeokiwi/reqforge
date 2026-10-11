// The editor's TipTap extension list: the shared schema (src/editor/schema) plus behaviour
// only. Schema extensions are configured or extended BY NAME, in place, so the editor's schema
// is exactly the server's (RD-063) — a test compares the two. Added on top:
//   - StarterKit with its schema parts off: history (undo/redo), drop cursor, gap cursor;
//   - the placeholder shown in an empty document;
//   - the table resizable, through EditorTableView (the numbered gutter, RD-069);
//   - node views for the info panel, status, date, mention and table of contents (node-views.ts);
//   - links that do not navigate when clicked while editing;
//   - the keyboard shortcuts of ONE table (shortcuts.ts), which the `?` dialog lists;
//   - `{` Macro suggestions (suggestion.ts), find and replace (find-replace.ts), upload
//     placeholders (uploads.ts);
//   - a paste and drop filter (paste.ts): text the database cannot store is stripped (RD-068),
//     HTML is sanitised, remote images are dropped (RD-058), code-block languages the server
//     refuses are cleared, and files are uploaded rather than pasted.
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063, RD-068); docs/specs/10-ui-reference.md sections 5.1, 5.4 and 5.5
import { type AnyExtension, Extension, type Mark, type Node } from "@tiptap/core";
import type { LinkOptions } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import type { TableOptions } from "@tiptap/extension-table";
import type { Slice } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { STARTER_KIT_BEHAVIOUR_ONLY, schemaExtensions } from "@/editor/schema";
import { isCodeLanguage } from "@/editor/schema/rules";
import { findPlugin } from "./find-replace";
import { DateView, InfoPanelView, MentionView, type NodeViewContext, StatusView, TableOfContentsView } from "./node-views";
import { cleanPastedSlice, filesToUpload, sanitizeHtml, stripUnstorable } from "./paste";
import { shortcutBindings } from "./shortcuts";
import { macroSuggestionsExtension } from "./suggestion";
import { EditorTableView, TABLE_CELL_MIN_WIDTH } from "./table-view";
import { EditorUiBridge } from "./ui-bridge";
import { UploadPlaceholders } from "./uploads";

export { stripUnstorable } from "./paste";

// ------------------------------------------------------------------------------ paste filter

/** A code block's language as the server stores it: kept when it is valid, else none (RD-068). */
function storableLanguage(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && isCodeLanguage(value) ? value : null;
}

/**
 * A paste from VS Code: TipTap's code block turns it into a code block in the editor's language
 * mode, straight from the clipboard, past every paste transform. Done here instead, with the
 * text stripped (RD-068) and the language checked, so the paste can never store what the server
 * refuses. Returns false (the paste goes the normal way) for anything else.
 */
// spec: docs/specs/09-decision-log.md section RD-068 (pasted text; code `language` one token of at most 64 characters)
export function pasteFromCodeEditor(view: EditorView, data: Pick<DataTransfer, "getData"> | null | undefined): boolean {
  if (!data) return false;
  let mode: unknown;
  let text: string;
  try {
    const raw = data.getData("vscode-editor-data");
    if (!raw) return false;
    mode = (JSON.parse(raw) as { mode?: unknown } | null)?.mode;
    text = stripUnstorable(data.getData("text/plain"));
  } catch {
    return false;
  }
  const codeBlock = view.state.schema.nodes.codeBlock;
  if (!codeBlock || !text || !mode || view.state.selection.$from.parent.type === codeBlock) return false;
  const tr = view.state.tr.replaceSelectionWith(codeBlock.create({ language: storableLanguage(mode) }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2))));
  tr.insertText(text.replace(/\r\n?/g, "\n"));
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
  return true;
}

/** Code blocks a transaction left with a language the server refuses, cleared (a backstop). */
function clearBadLanguages(state: EditorState): Transaction | null {
  let tr: Transaction | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      if (!isCodeLanguage(node.attrs.language)) {
        tr ??= state.tr;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: null });
      }
      return false;
    }
    return !node.isTextblock;
  });
  return tr;
}

// spec: docs/specs/09-decision-log.md sections RD-058 (a pasted remote image keeps its text and drops the image) and RD-068
export function pasteFilterExtension(ui: EditorUiBridge): Extension {
  return Extension.create({
    name: "rfPasteFilter",
    // Before the schema extensions' own paste handlers (the code block's VS Code handler).
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("rfPasteFilter"),
          props: {
            transformPastedText: (text) => stripUnstorable(text),
            transformPastedHTML: (html) => sanitizeHtml(html),
            transformPasted: (slice: Slice) => cleanPastedSlice(slice, { keepImage: (id) => ui.isKnownAttachment(id) }),
            handlePaste: (view, event) => {
              const files = filesToUpload(event.clipboardData);
              if (files.length > 0) return ui.call("uploadFiles", files, null);
              return pasteFromCodeEditor(view, event.clipboardData);
            },
            handleDrop: (view, event, _slice, moved) => {
              if (moved) return false;
              const files = filesToUpload(event.dataTransfer);
              if (files.length === 0) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              return ui.call("uploadFiles", files, at ? at.pos : null);
            },
          },
          appendTransaction: (transactions, _old, state) =>
            transactions.some((tr) => tr.docChanged && (tr.getMeta("paste") === true || tr.getMeta("uiEvent") === "drop")) ? clearBadLanguages(state) : null,
        }),
      ];
    },
  });
}

// --------------------------------------------------------------------------- the other parts

function asNode<O>(extension: AnyExtension): Node<O> {
  return extension as Node<O>;
}

function asMark<O>(extension: AnyExtension): Mark<O> {
  return extension as Mark<O>;
}

function viewContext(props: { editor: NodeViewContext["editor"]; node: NodeViewContext["node"]; getPos: unknown }): NodeViewContext {
  const getPos = props.getPos;
  return {
    editor: props.editor,
    node: props.node,
    getPos: () => (typeof getPos === "function" ? (getPos as () => number | undefined)() : undefined),
  };
}

/** Behaviour added to schema extensions, keyed by the extension's name. */
function byName(ui: EditorUiBridge): Readonly<Record<string, (extension: AnyExtension) => AnyExtension>> {
  return {
    table: (extension) =>
      asNode<TableOptions>(extension)
        .configure({ resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH, View: EditorTableView, lastColumnResizable: true })
        .extend({
          addNodeView() {
            const cellMinWidth = this.options.cellMinWidth;
            return ({ node }) => new EditorTableView(node, cellMinWidth);
          },
        }),
    link: (extension) => asMark<LinkOptions>(extension).configure({ openOnClick: false }),
    // Its keys are in the shortcuts table (with the toolbar's meaning: left is the default), and
    // its Mod-Shift-j (justify) is not offered: the toolbar has three alignments (RD-057).
    textAlign: (extension) => extension.extend({ addKeyboardShortcuts: () => ({}) }),
    infoPanel: (extension) => asNode(extension).extend({ addNodeView: () => (props) => new InfoPanelView(viewContext(props)) }),
    status: (extension) => asNode(extension).extend({ addNodeView: () => (props) => new StatusView(viewContext(props), ui) }),
    date: (extension) => asNode(extension).extend({ addNodeView: () => (props) => new DateView(viewContext(props), ui) }),
    mention: (extension) => asNode(extension).extend({ addNodeView: () => (props) => new MentionView(viewContext(props)) }),
    tableOfContents: (extension) => asNode(extension).extend({ addNodeView: () => (props) => new TableOfContentsView(viewContext(props)) }),
  };
}

/** The `rfShortcuts` keymap: every `editor` binding of the shortcuts table. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`?`: the bindings and the dialog are one table); RD-057
export function shortcutsExtension(ui: EditorUiBridge): Extension {
  return Extension.create({
    name: "rfShortcuts",
    // Before the schema extensions' own keymaps, which bind some of the same keys.
    priority: 1050,
    addKeyboardShortcuts() {
      return shortcutBindings(this.editor, ui);
    },
  });
}

export const FindAndReplace = Extension.create({
  name: "rfFind",
  addProseMirrorPlugins() {
    return [findPlugin()];
  },
});

export interface EditorExtensionOptions {
  /** Shown in an empty document (copy deck `editor.placeholder`). */
  readonly placeholder: string;
  /** How the extensions reach the React UI; a headless bridge (every call a no-op) by default. */
  readonly ui?: EditorUiBridge;
}

/** The extension list for `useEditor`. Never adds or removes a node or mark. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (one schema for editor, renderer and server, RD-063)
export function buildEditorExtensions({ placeholder, ui = new EditorUiBridge() }: EditorExtensionOptions): AnyExtension[] {
  const extend = byName(ui);
  const schema = schemaExtensions.map((extension) => extend[extension.name]?.(extension) ?? extension);
  return [
    ...schema,
    StarterKit.configure(STARTER_KIT_BEHAVIOUR_ONLY),
    Placeholder.configure({ placeholder }),
    pasteFilterExtension(ui),
    shortcutsExtension(ui),
    macroSuggestionsExtension(ui),
    FindAndReplace,
    UploadPlaceholders,
  ];
}
