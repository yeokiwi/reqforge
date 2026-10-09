// The JSON shapes of canonical ProseMirror content (`03` §1.5). Canonical content is what
// `validateDocumentJson` returns, what the server stores and what the indexer reads.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface MarkJson {
  type: string;
  attrs?: Record<string, JsonValue>;
}

export interface NodeJson {
  type: string;
  attrs?: Record<string, JsonValue>;
  content?: NodeJson[];
  marks?: MarkJson[];
  text?: string;
}

/** A canonical document: `doc` always has at least one block. */
export interface DocumentJson extends NodeJson {
  type: "doc";
  content: NodeJson[];
}
