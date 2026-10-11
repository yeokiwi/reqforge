// RD-063 caps nesting at 64 nodes deep (`doc` is 1, text nodes count) and the server refuses a
// deeper document; every autosave after that would be a 422 with nothing pointing at the nesting.
// The editor never builds one:
//   - a paste, a drop or the Markup dialog whose content would land too deep is flattened: its
//     textblocks (paragraphs, headings, code) and leaf blocks are kept, with their text and marks,
//     in order; the containers around them (quotes, lists, panels, tables) are dropped;
//   - ⇥ does not sink a list item past the limit, and is disabled there (commands.ts);
//   - a backstop refuses any other transaction that would go deeper: a typed `> ` in a deep quote,
//     Tab in a deep list, a table inserted into a deep table cell.
// Only the part of the document a transaction changed is measured, so typing stays cheap.
// spec: docs/specs/09-decision-log.md section RD-063 (nesting depth at most 64; depth counts ProseMirror nodes)
import { Extension } from "@tiptap/core";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { MAX_NODE_DEPTH } from "@/editor/schema";

/** Whether `node` and everything inside it fit in `levels` levels of nesting (a leaf takes one). */
export function fitsWithin(node: PMNode, levels: number): boolean {
  if (levels < 1) return false;
  if (node.childCount === 0) return true;
  if (levels < 2) return false;
  for (let i = 0; i < node.childCount; i++) {
    if (!fitsWithin(node.child(i), levels - 1)) return false;
  }
  return true;
}

/** The part of `tr.doc` the transaction's steps replaced, or null when no step replaced anything. */
function changedRange(tr: Transaction): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const map of tr.mapping.maps) {
    // What earlier steps changed, carried through this one (only ever widened).
    if (from <= to) {
      from = map.map(from, -1);
      to = map.map(to, 1);
    }
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, newStart);
      to = Math.max(to, newEnd);
    });
  }
  return from <= to ? { from, to } : null;
}

/**
 * Whether a node of `parent`'s content that touches [from, to] is deeper than the limit.
 * `depth` is `parent`'s own depth (`doc` is 1); `start` is where its content starts.
 */
function tooDeepBetween(parent: PMNode, depth: number, start: number, from: number, to: number): boolean {
  const room = MAX_NODE_DEPTH - depth; // levels left for a child and everything inside it
  let pos = start;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = pos;
    const childEnd = pos + child.nodeSize;
    pos = childEnd;
    if (childEnd < from) continue;
    if (childStart > to) break;
    if (childStart >= from && childEnd <= to) {
      if (!fitsWithin(child, room)) return true;
    } else if (room < 1) {
      return true;
    } else if (!child.isLeaf && tooDeepBetween(child, depth + 1, childStart + 1, from, to)) {
      return true;
    }
  }
  return false;
}

/** Whether the document a transaction produces has a node deeper than RD-063 allows where it changed. */
// spec: docs/specs/09-decision-log.md section RD-063 (nesting depth at most 64)
export function exceedsDepth(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  const range = changedRange(tr);
  if (!range) return false;
  const $from = tr.doc.resolve(range.from);
  // Typing: the change is inline content of one textblock, whose own depth is known.
  if ($from.parent.inlineContent && range.to <= $from.end()) return $from.depth + 2 > MAX_NODE_DEPTH;
  return tooDeepBetween(tr.doc, 1, 0, range.from, range.to);
}

/**
 * A slice's textblocks and leaf blocks, in order, without the containers around them: what a
 * paste keeps when its structure would go too deep. An end stays open when it was open and is a
 * textblock, so the first and last paragraphs still flow into the text at the caret.
 */
// spec: docs/specs/09-decision-log.md section RD-063 (nesting depth at most 64)
export function flattenSlice(slice: Slice): Slice {
  if (slice.content.firstChild?.isInline) return slice;
  const blocks: PMNode[] = [];
  slice.content.descendants((node) => {
    if (node.isTextblock || (node.isBlock && node.isLeaf)) {
      blocks.push(node);
      return false;
    }
    return true;
  });
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return Slice.empty;
  const openStart = Math.min(slice.openStart, first.isTextblock ? 1 : 0);
  const openEnd = Math.min(slice.openEnd, last.isTextblock ? 1 : 0);
  return new Slice(Fragment.fromArray(blocks), openStart, openEnd);
}

/**
 * The slice as it may go in at the selection: itself when the result fits in RD-063's depth,
 * else flattened. (Whatever still does not fit is refused by the backstop, whole.)
 */
// spec: docs/specs/09-decision-log.md section RD-063 (nesting depth at most 64)
export function fitSliceToDepth(state: EditorState, slice: Slice): Slice {
  try {
    if (!exceedsDepth(state.tr.replaceSelection(slice))) return slice;
  } catch {
    return slice; // a slice ProseMirror cannot place: its own paste path decides
  }
  return flattenSlice(slice);
}

/** The backstop: a transaction that would nest content deeper than RD-063 allows is not applied. */
// spec: docs/specs/09-decision-log.md section RD-063 (nesting depth at most 64)
export const DepthGuard = Extension.create({
  name: "rfDepthGuard",
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey("rfDepthGuard"), filterTransaction: (tr) => !exceedsDepth(tr) })];
  },
});
