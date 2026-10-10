// The editor's TipTap extension list: the shared schema (src/editor/schema) plus behaviour
// only. Schema extensions are configured or extended BY NAME, in place, so the editor's schema
// is exactly the server's (RD-063) — a test compares the two. Added on top:
//   - StarterKit with its schema parts off: history (undo/redo), drop cursor, gap cursor;
//   - the placeholder shown in an empty document;
//   - the table resizable, through EditorTableView (the numbered gutter, RD-069);
//   - links that do not navigate when clicked while editing;
//   - a paste filter that strips what the database cannot store (RD-068).
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063, RD-068); docs/specs/10-ui-reference.md section 5.1
import { type AnyExtension, Extension, type Mark, type Node } from "@tiptap/core";
import type { LinkOptions } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import type { TableOptions } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { STARTER_KIT_BEHAVIOUR_ONLY, schemaExtensions } from "@/editor/schema";
import { EditorTableView, TABLE_CELL_MIN_WIDTH } from "./table-view";

/**
 * Removes what PostgreSQL `jsonb` cannot hold — U+0000 and unpaired UTF-16 surrogates — from
 * pasted or dropped text, so a paste cannot make every later autosave fail with a 422.
 */
// spec: docs/specs/09-decision-log.md section RD-068 (the editor strips them from pasted text)
export function stripUnstorable(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\p{Cs}/gu, "");
}

export const PasteFilter = Extension.create({
  name: "rfPasteFilter",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rfPasteFilter"),
        props: {
          transformPastedText: (text) => stripUnstorable(text),
          transformPastedHTML: (html) => stripUnstorable(html),
        },
      }),
    ];
  },
});

function asNode<O>(extension: AnyExtension): Node<O> {
  return extension as Node<O>;
}

function asMark<O>(extension: AnyExtension): Mark<O> {
  return extension as Mark<O>;
}

/** Behaviour added to schema extensions, keyed by the extension's name. */
const BY_NAME: Readonly<Record<string, (extension: AnyExtension) => AnyExtension>> = {
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
};

export interface EditorExtensionOptions {
  /** Shown in an empty document (copy deck `editor.placeholder`). */
  readonly placeholder: string;
}

/** The extension list for `useEditor`. Never adds or removes a node or mark. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (one schema for editor, renderer and server, RD-063)
export function buildEditorExtensions({ placeholder }: EditorExtensionOptions): AnyExtension[] {
  const schema = schemaExtensions.map((extension) => BY_NAME[extension.name]?.(extension) ?? extension);
  return [
    ...schema,
    StarterKit.configure(STARTER_KIT_BEHAVIOUR_ONLY),
    Placeholder.configure({ placeholder }),
    PasteFilter,
  ];
}
