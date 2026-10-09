// The one ProseMirror schema: built from the TipTap extensions with no DOM, imported by the
// editor, the page renderer and the server's validator (RD-063).
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063)
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { schemaExtensions } from "./extensions";

export const documentSchema: Schema = getSchema([...schemaExtensions]);

/** Node type names in schema order (`doc` first, `text` included). */
export const NODE_NAMES: readonly string[] = Object.freeze(Object.keys(documentSchema.nodes));

/** Mark type names in schema (rank) order. */
export const MARK_NAMES: readonly string[] = Object.freeze(Object.keys(documentSchema.marks));
