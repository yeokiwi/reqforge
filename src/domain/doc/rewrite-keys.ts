/**
 * Rewriting requirement keys inside a document's ProseMirror JSON.
 * Pure: takes JSON, returns JSON. spec: 03-authoring-and-indexing.md §5 (propagation).
 *
 * This is the half of a rename that makes it correct rather than merely tidy. The indexer
 * reconciles requirements by key (contract I2), and a key that disappears from its
 * document becomes `DELETED` (contract I3) — so a rename that updated the row but left the
 * document saying the old key would, on that document's next save, resurrect the old key
 * as a new requirement and delete the renamed one.
 */
import { buildMapping, type KeyMapping } from '@/domain/keys/rename';
import { rewriteKeyLiterals } from '@/domain/ryql/rewrite';
import { LINK_NODE, MARKER_NODE } from './references';
import { attr, childrenOf, isPMNode, type PMNode } from './types';

/** The one node that embeds a query in the document rather than on a row. */
const REPORT_NODE = 'report';

export type RewriteOutcome = {
  content: PMNode;
  /** Node attributes actually changed. Zero means the document needs no new version. */
  changed: number;
};

function mappedKey(key: string | undefined, mapping: KeyMapping): string | undefined {
  if (key === undefined || key.length === 0) return undefined;
  return mapping.byUpper.get(key.toUpperCase());
}

function rewriteNode(
  node: PMNode,
  mapping: KeyMapping,
  spaceKey: string,
  counter: { changed: number },
): PMNode {
  let attrs: Record<string, unknown> | undefined;

  if (node.type === MARKER_NODE) {
    const next = mappedKey(attr(node, 'key'), mapping);
    if (next !== undefined) {
      // The uid is the marker's identity and survives a key change by design
      // (spec 03 §1.1), so only `key` moves.
      attrs = { ...node.attrs, key: next };
      counter.changed += 1;
    }
  } else if (node.type === LINK_NODE) {
    const linkSpace = attr(node, 'spaceKey');
    const sameSpace = linkSpace === undefined || linkSpace === null || linkSpace === spaceKey;
    // RD-007 / RD-052 — a link pinned to a baseline points at a frozen row, which keeps
    // the key it was frozen with. Rewriting it would silently re-point it.
    const pinned = node.attrs?.baselineNumber !== undefined && node.attrs?.baselineNumber !== null;
    if (sameSpace && !pinned) {
      const next = mappedKey(attr(node, 'key'), mapping);
      if (next !== undefined) {
        attrs = { ...node.attrs, key: next };
        counter.changed += 1;
      }
    }
  } else if (node.type === REPORT_NODE) {
    const query = attr(node, 'query');
    if (query !== undefined && query.trim().length > 0) {
      const rewritten = rewriteKeyLiterals(query, mapping);
      if (rewritten.ok && rewritten.changed > 0) {
        attrs = { ...node.attrs, query: rewritten.query };
        counter.changed += rewritten.changed;
      }
    }
  }

  const children = childrenOf(node);
  let content: PMNode[] | undefined;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const rewritten = rewriteNode(child, mapping, spaceKey, counter);
    if (rewritten !== child && content === undefined) content = children.slice();
    if (content !== undefined) content[index] = rewritten;
  }

  if (attrs === undefined && content === undefined) return node;
  return { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
}

/**
 * Returns the document with every reference to a renamed key updated.
 *
 * Where nothing changed the *same object* comes back, so a caller can detect an untouched
 * document by identity and skip writing it a new version — a batch rename across a space
 * touches far fewer documents than it reads.
 *
 * spec: 03-authoring-and-indexing.md §5 (propagation)
 */
export function rewriteKeys(
  content: unknown,
  pairs: ReadonlyArray<{ from: string; to: string }>,
  spaceKey: string,
): RewriteOutcome {
  if (!isPMNode(content)) return { content: { type: 'doc' }, changed: 0 };
  if (pairs.length === 0) return { content, changed: 0 };

  const counter = { changed: 0 };
  const rewritten = rewriteNode(content, buildMapping(pairs), spaceKey, counter);
  return { content: rewritten, changed: counter.changed };
}
