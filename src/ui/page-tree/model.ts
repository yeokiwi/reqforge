// The page tree's pure logic, shared by the space sidebar and the space overview (10 §3.2,
// §11). No React, no fetch: the store and the components call these, and the tests call them
// directly. The server is the authority on the tree (RD-056, RD-070); `planMove` from the
// domain is the model of what it will do with a move, so the optimistic picture the user sees
// is computed by the same function the server runs.
import {
  buildTree,
  planMove,
  wouldCreateCycle,
  type PageSummary,
} from "@/domain/documents";

/** One page as the tree draws it. Objects are reused between models when nothing changed. */
export interface TreeNodeView {
  readonly id: string;
  readonly title: string;
  /** The parent as the tree shows it: null for a root, including a page whose parent is missing. */
  readonly parentId: string | null;
  /** Children in sibling order (RD-056: dense ordinal, then title, then id). */
  readonly childIds: readonly string[];
}

export interface TreeModel {
  /** The flat list the model was built from (08 §3: GET /pages). */
  readonly pages: readonly PageSummary[];
  readonly rootIds: readonly string[];
  readonly nodes: ReadonlyMap<string, TreeNodeView>;
}

export const EMPTY_MODEL: TreeModel = { pages: [], rootIds: [], nodes: new Map() };

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Builds the tree from GET /pages' flat list. `previous` enables structural sharing: a node
 * whose title, parent and children are unchanged keeps its object, and an unchanged child list
 * keeps its array — which is what lets a 2,000-page tree re-render only the items that changed.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages: flat, ordered by ordinal within parentId); RD-056
export function buildModel(pages: readonly PageSummary[], previous?: TreeModel): TreeModel {
  const forest = buildTree(pages);
  const nodes = new Map<string, TreeNodeView>();
  const prev = previous?.nodes;
  // Iterative post-order, so a deep chain cannot overflow the call stack (the database allows
  // 1,000 levels, RD-070).
  type Frame = { node: (typeof forest)[number]; parentId: string | null; next: number };
  const stack: Frame[] = [];
  for (let r = forest.length - 1; r >= 0; r--) stack.push({ node: forest[r] as (typeof forest)[number], parentId: null, next: 0 });
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    const children = frame.node.children;
    if (frame.next < children.length) {
      const child = children[frame.next++] as (typeof forest)[number];
      stack.push({ node: child, parentId: frame.node.page.id, next: 0 });
      continue;
    }
    stack.pop();
    const { id, title } = frame.node.page;
    const fresh = children.map((c) => c.page.id);
    const old = prev?.get(id);
    const childIds = old && sameIds(old.childIds, fresh) ? old.childIds : fresh;
    const reuse = old && old.title === title && old.parentId === frame.parentId && old.childIds === childIds;
    nodes.set(id, reuse ? old : { id, title, parentId: frame.parentId, childIds });
  }
  const freshRoots = forest.map((n) => n.page.id);
  const rootIds = previous && sameIds(previous.rootIds, freshRoots) ? previous.rootIds : freshRoots;
  return { pages, rootIds, nodes };
}

/** Ancestors of a page, root first, excluding the page. Unknown id: []. */
// spec: docs/specs/10-ui-reference.md section 3.2 (the current page's ancestors are open)
export function ancestorIds(model: TreeModel, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let parent = model.nodes.get(id)?.parentId ?? null;
  while (parent !== null && !seen.has(parent)) {
    out.push(parent);
    seen.add(parent);
    parent = model.nodes.get(parent)?.parentId ?? null;
  }
  return out.reverse();
}

/** The rows a reader sees, top to bottom: depth-first, children only under open pages. */
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE)
export function visibleIds(model: TreeModel, isOpen: (id: string) => boolean): string[] {
  const out: string[] = [];
  const stack: string[] = [...model.rootIds].reverse();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    out.push(id);
    const node = model.nodes.get(id);
    if (!node || node.childIds.length === 0 || !isOpen(id)) continue;
    for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i] as string);
  }
  return out;
}

/**
 * The row that stands for `id` on screen: the page itself when every ancestor is open, else
 * the highest closed ancestor (which hides it). Unknown id: null.
 */
export function visibleRepresentative(model: TreeModel, id: string, isOpen: (id: string) => boolean): string | null {
  if (!model.nodes.has(id)) return null;
  for (const ancestor of ancestorIds(model, id)) if (!isOpen(ancestor)) return ancestor;
  return id;
}

// ---- URLs (10 §11) -------------------------------------------------------------------------

const enc = encodeURIComponent;

// spec: docs/specs/10-ui-reference.md section 11 (Page: /spaces/{SPACE}/pages/{pageId})
export function pageHref(spaceKey: string, id: string): string {
  return `/spaces/${enc(spaceKey)}/pages/${enc(id)}`;
}

// spec: docs/specs/10-ui-reference.md section 11 (Editor: /spaces/{SPACE}/pages/{pageId}/edit)
export function editHref(spaceKey: string, id: string): string {
  return `${pageHref(spaceKey, id)}/edit`;
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The page a pathname shows in this space — `/spaces/{KEY}/pages/{id}`, and anything below it
 * (history, compare) — or null. Space keys are case-insensitive in URLs (08 §3).
 */
// spec: docs/specs/10-ui-reference.md sections 3.2 (current page in bold) and 11 (URLs)
export function currentPageIdFromPath(pathname: string | null, spaceKey: string): string | null {
  if (!pathname) return null;
  const parts = pathname.split("/");
  // ["", "spaces", KEY, "pages", id, ...]
  if (parts[1] !== "spaces" || parts[3] !== "pages") return null;
  const key = safeDecode(parts[2] ?? "");
  const id = safeDecode(parts[4] ?? "");
  if (key === null || id === null || id === "") return null;
  return key.toUpperCase() === spaceKey.toUpperCase() ? id : null;
}

// ---- Moves (RD-056: within one space; 08 §3: POST /pages/{id}/move { parentId, index }) ----

/** Where a moved page goes: its new parent and its 0-based index among the new siblings, itself left out. */
export interface MoveTarget {
  readonly parentId: string | null;
  readonly index: number;
}

export type DropZone = "before" | "inside" | "after";

/** Top quarter of a row: before it. Bottom quarter: after it. The middle: onto it. */
export function zoneFor(offsetY: number, height: number): DropZone {
  if (!Number.isFinite(offsetY) || !Number.isFinite(height) || height <= 0) return "inside";
  if (offsetY < height / 4) return "before";
  if (offsetY >= (height * 3) / 4) return "after";
  return "inside";
}

function siblingsOf(model: TreeModel, parentId: string | null): readonly string[] {
  return parentId === null ? model.rootIds : (model.nodes.get(parentId)?.childIds ?? []);
}

/** Would this move leave the page where it is? */
export function isNoopMove(model: TreeModel, id: string, target: MoveTarget): boolean {
  const node = model.nodes.get(id);
  if (!node || node.parentId !== target.parentId) return false;
  return siblingsOf(model, node.parentId).indexOf(id) === target.index;
}

/**
 * The move a drop asks for, or null when the drop is refused before anything is sent: onto
 * the page itself or one of its descendants (`wouldCreateCycle`, RD-056), unknown pages, or a
 * drop that would leave the page where it is.
 *
 * - `before` / `after`: next to the target, under the target's parent.
 * - `inside`: the target's last child.
 * - `after` an OPEN page with children means "its first child": the indicator line is drawn
 *   under the row, which is where that child appears.
 */
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE: drag to reorder and re-parent); RD-056 (no cycles)
export function moveForDrop(
  model: TreeModel,
  dragId: string,
  targetId: string,
  zone: DropZone,
  targetOpen: boolean,
): MoveTarget | null {
  const target = model.nodes.get(targetId);
  if (!target || !model.nodes.has(dragId)) return null;
  let move: MoveTarget;
  if (zone === "inside") {
    move = { parentId: targetId, index: target.childIds.filter((c) => c !== dragId).length };
  } else if (zone === "after" && targetOpen && target.childIds.some((c) => c !== dragId)) {
    move = { parentId: targetId, index: 0 };
  } else {
    const siblings = siblingsOf(model, target.parentId).filter((s) => s !== dragId);
    const at = siblings.indexOf(targetId);
    if (at < 0) return null; // the target is the dragged page itself
    move = { parentId: target.parentId, index: zone === "before" ? at : at + 1 };
  }
  if (wouldCreateCycle(model.pages, dragId, move.parentId)) return null;
  if (isNoopMove(model, dragId, move)) return null;
  return move;
}

export type KeyMove = "up" | "down" | "indent" | "outdent";

/**
 * The keyboard equivalent of a drag (WCAG 2.1.1): Alt+↑ / Alt+↓ swap with the previous / next
 * sibling; Alt+Shift+→ makes the page the last child of its previous sibling; Alt+Shift+←
 * moves it up a level, right after its parent. Null when there is nowhere to go.
 */
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE: drag to reorder and re-parent); RD-056
export function moveForKey(model: TreeModel, id: string, kind: KeyMove): MoveTarget | null {
  const node = model.nodes.get(id);
  if (!node) return null;
  const siblings = siblingsOf(model, node.parentId);
  const at = siblings.indexOf(id);
  if (at < 0) return null;
  switch (kind) {
    case "up":
      return at === 0 ? null : { parentId: node.parentId, index: at - 1 };
    case "down":
      return at === siblings.length - 1 ? null : { parentId: node.parentId, index: at + 1 };
    case "indent": {
      const previous = at === 0 ? undefined : siblings[at - 1];
      if (previous === undefined) return null;
      const children = model.nodes.get(previous)?.childIds ?? [];
      return { parentId: previous, index: children.length };
    }
    case "outdent": {
      if (node.parentId === null) return null;
      const parent = model.nodes.get(node.parentId);
      if (!parent) return null;
      const parentSiblings = siblingsOf(model, parent.parentId);
      return { parentId: parent.parentId, index: parentSiblings.indexOf(parent.id) + 1 };
    }
  }
}

/**
 * The flat list after a move, as the server would store it (`planMove`: dense ordinals in
 * both affected sibling lists). The same array when the move is refused or changes nothing.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (moves renumber the affected sibling lists densely)
export function applyMove(pages: readonly PageSummary[], id: string, target: MoveTarget): readonly PageSummary[] {
  const plan = planMove({ pages, id, parentId: target.parentId, index: target.index });
  if (!plan.ok || plan.changes.length === 0) return pages;
  const changes = new Map(plan.changes.map((c) => [c.id, c]));
  return pages.map((p) => {
    const change = changes.get(p.id);
    return change ? { ...p, parentId: change.parentId, ordinal: change.ordinal } : p;
  });
}

/** Where a page now sits, for the announcement after a keyboard move: 1-based. */
export interface Position {
  readonly parentTitle: string | null;
  readonly position: number;
  readonly count: number;
}

export function positionOf(model: TreeModel, id: string): Position | null {
  const node = model.nodes.get(id);
  if (!node) return null;
  const siblings = siblingsOf(model, node.parentId);
  const at = siblings.indexOf(id);
  if (at < 0) return null;
  const parentTitle = node.parentId === null ? null : (model.nodes.get(node.parentId)?.title ?? null);
  return { parentTitle, position: at + 1, count: siblings.length };
}

// ---- Wire data -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A PageSummary out of anything shaped like one (a PageDetail is one too), else null. */
export function toPageSummary(value: unknown): PageSummary | null {
  if (!isRecord(value)) return null;
  const { id, title, parentId, ordinal, currentVersion, lastModifiedAt } = value;
  if (typeof id !== "string" || typeof title !== "string") return null;
  if (parentId !== null && typeof parentId !== "string") return null;
  if (typeof ordinal !== "number" || !Number.isFinite(ordinal)) return null;
  return {
    id,
    title,
    parentId,
    ordinal,
    currentVersion: typeof currentVersion === "number" ? currentVersion : 0,
    lastModifiedAt: typeof lastModifiedAt === "string" ? lastModifiedAt : "",
  };
}

/** GET /pages' body (a bare PageSummary[], RD-072), or null when it is not an array. Malformed entries are dropped. */
// spec: docs/specs/09-decision-log.md section RD-072 (GET …/pages → a bare PageSummary[])
export function parsePages(body: unknown): PageSummary[] | null {
  if (!Array.isArray(body)) return null;
  const out: PageSummary[] = [];
  for (const item of body) {
    const page = toPageSummary(item);
    if (page) out.push(page);
  }
  return out;
}

/** Field-by-field equality, so a refetch that changes nothing changes nothing on screen. */
export function samePages(a: readonly PageSummary[], b: readonly PageSummary[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as PageSummary;
    const y = b[i] as PageSummary;
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.parentId !== y.parentId ||
      x.ordinal !== y.ordinal ||
      x.currentVersion !== y.currentVersion ||
      x.lastModifiedAt !== y.lastModifiedAt
    ) {
      return false;
    }
  }
  return true;
}

/** Ids as the API writes them (`[A-Za-z0-9_-]{1,64}`, RD-072). */
export function isPageId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
