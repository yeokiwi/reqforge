/**
 * ProseMirror JSON, as stored in `DocumentVersion.content`.
 * spec: 03-authoring-and-indexing.md §1 — "Documents are ProseMirror JSON."
 *
 * These types are structural on purpose: the indexer must be able to walk a document
 * that was written by an older editor build without throwing.
 */
export type PMMark = { type: string; attrs?: Record<string, unknown> };

export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
};

export function isPMNode(value: unknown): value is PMNode {
  return typeof value === 'object' && value !== null && typeof (value as PMNode).type === 'string';
}

export function childrenOf(node: PMNode): PMNode[] {
  return Array.isArray(node.content) ? node.content.filter(isPMNode) : [];
}

export function attr(node: PMNode, name: string): string | undefined {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value : undefined;
}

export function numericAttr(node: PMNode, name: string): number | undefined {
  const value = node.attrs?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function booleanAttr(node: PMNode, name: string): boolean {
  return node.attrs?.[name] === true;
}

export function emptyDocument(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * A node's position in the document tree, as `0.3.1` — child indexes from the root.
 * Stored as `Requirement.anchorPath` for deep links (spec 01, `anchorPath`).
 */
export type AnchorPath = string;

export function childPath(parent: AnchorPath, index: number): AnchorPath {
  return parent === '' ? String(index) : `${parent}.${index}`;
}

/** Walks the tree depth-first, yielding every node with its anchor path. */
export function* walk(root: PMNode, path: AnchorPath = ''): Generator<{ node: PMNode; path: AnchorPath }> {
  yield { node: root, path };
  const children = childrenOf(root);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child) yield* walk(child, childPath(path, index));
  }
}

export function nodeAt(root: PMNode, path: AnchorPath): PMNode | undefined {
  if (path === '') return root;
  let node: PMNode | undefined = root;
  for (const segment of path.split('.')) {
    if (!node) return undefined;
    const index = Number.parseInt(segment, 10);
    node = Number.isNaN(index) ? undefined : childrenOf(node)[index];
  }
  return node;
}
