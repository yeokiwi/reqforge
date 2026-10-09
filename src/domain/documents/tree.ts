// The page tree (RD-056). Pure functions over a flat list of pages, as GET /pages returns
// them (08 §3). The database is the authority on shape — a trigger refuses cycles and
// cross-space parents — but these functions must still terminate and answer sensibly on
// data that breaks those rules, because a list can be stale or partial.

export interface PageNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly ordinal: number;
  readonly title: string;
}

export interface TreeNode<T extends PageNode> {
  page: T;
  /** 0 for a root. */
  depth: number;
  children: TreeNode<T>[];
}

export interface PlannedChange {
  id: string;
  parentId: string | null;
  ordinal: number;
}

export type MoveRefusal = "UNKNOWN_PAGE" | "UNKNOWN_PARENT" | "CYCLE";
export type MovePlan = { ok: true; changes: PlannedChange[] } | { ok: false; reason: MoveRefusal };

export interface MoveRequest<T extends PageNode> {
  pages: readonly T[];
  /** The page being moved. */
  id: string;
  /** The new parent, or null for the root of the space. */
  parentId: string | null;
  /** 0-based position among the new siblings, not counting the moved page; rounded down, then clamped. */
  index: number;
}

/**
 * Sibling order: `ordinal`, then `title`, then `id`. Titles and ids compare by UTF-16 code
 * unit, not by locale, so the order is the same on every server and browser.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (siblings ordered by a dense ordinal)
export function compareSiblings(a: PageNode, b: PageNode): number {
  if (a.ordinal !== b.ordinal) return a.ordinal < b.ordinal ? -1 : 1;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function indexById<T extends PageNode>(pages: readonly T[]): Map<string, T> {
  const byId = new Map<string, T>();
  for (const p of pages) if (!byId.has(p.id)) byId.set(p.id, p);
  return byId;
}

/** The parent as the tree sees it: a missing parent, or the page itself, means "root". */
function effectiveParentId(page: PageNode, byId: ReadonlyMap<string, PageNode>): string | null {
  const pid = page.parentId;
  return pid !== null && pid !== page.id && byId.has(pid) ? pid : null;
}

function childrenIndex<T extends PageNode>(byId: ReadonlyMap<string, T>): Map<string | null, T[]> {
  const children = new Map<string | null, T[]>();
  for (const p of byId.values()) {
    const key = effectiveParentId(p, byId);
    const list = children.get(key);
    if (list) list.push(p);
    else children.set(key, [p]);
  }
  for (const list of children.values()) list.sort(compareSiblings);
  return children;
}

/**
 * Builds the forest. Every page (first occurrence of each id) appears exactly once:
 * a page whose parent is missing becomes a root, and if the data contains a cycle the
 * cycle's first member in sibling order is promoted to a root, so nothing loops and
 * nothing disappears.
 */
// spec: docs/specs/09-decision-log.md section RD-056; docs/specs/08-api-surface.md section 3 (GET /pages)
export function buildTree<T extends PageNode>(pages: readonly T[]): TreeNode<T>[] {
  const byId = indexById(pages);
  const children = childrenIndex(byId);
  const roots: T[] = [...(children.get(null) ?? [])];

  const reached = new Set<string>();
  const reach = (start: T) => {
    const stack: T[] = [start];
    while (stack.length > 0) {
      const p = stack.pop() as T;
      if (reached.has(p.id)) continue;
      reached.add(p.id);
      for (const c of children.get(p.id) ?? []) stack.push(c);
    }
  };
  for (const r of roots) reach(r);

  if (reached.size < byId.size) {
    // Whatever is left hangs off a cycle. Break each cycle at its first member.
    for (const p of [...byId.values()].sort(compareSiblings)) {
      if (reached.has(p.id)) continue;
      const root = cycleRepresentative(p, byId);
      roots.push(root);
      reach(root);
    }
    roots.sort(compareSiblings);
  }

  // Depth-first with an explicit stack of frames, not native recursion: a chain of pages can
  // be deeper than the call stack (the database bounds a new parent's ancestors, not the
  // depth of the subtree moved under it).
  const rootIds = new Set(roots.map((r) => r.id));
  const placed = new Set<string>();
  const forest: TreeNode<T>[] = [];
  const stack: Array<{ node: TreeNode<T>; kids: readonly T[]; next: number }> = [];
  for (const r of roots) {
    placed.add(r.id);
    const root: TreeNode<T> = { page: r, depth: 0, children: [] };
    forest.push(root);
    stack.push({ node: root, kids: children.get(r.id) ?? [], next: 0 });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as (typeof stack)[number];
      const c = frame.kids[frame.next++];
      if (c === undefined) {
        stack.pop();
        continue;
      }
      if (rootIds.has(c.id) || placed.has(c.id)) continue;
      placed.add(c.id);
      const node: TreeNode<T> = { page: c, depth: frame.node.depth + 1, children: [] };
      frame.node.children.push(node);
      stack.push({ node, kids: children.get(c.id) ?? [], next: 0 });
    }
  }
  return forest;
}

/** Walks up from an unreachable page to the cycle above it and returns its first member. */
function cycleRepresentative<T extends PageNode>(start: T, byId: ReadonlyMap<string, T>): T {
  const path: T[] = [];
  const position = new Map<string, number>();
  let cur: T | undefined = start;
  while (cur !== undefined && !position.has(cur.id)) {
    position.set(cur.id, path.length);
    path.push(cur);
    const pid = effectiveParentId(cur, byId);
    cur = pid === null ? undefined : byId.get(pid);
  }
  // cur === undefined cannot happen for an unreachable page; fall back to the start.
  if (cur === undefined) return start;
  const cycle = path.slice(position.get(cur.id));
  return cycle.reduce((best, p) => (compareSiblings(p, best) < 0 ? p : best));
}

/**
 * The ancestors of a page, root first, excluding the page itself (PageDetail.ancestors,
 * 08 §3.1). Unknown id: []. Stops at a missing parent, and at the first repeat if the
 * data contains a cycle.
 */
// spec: docs/specs/08-api-surface.md section 3.1 (PageDetail.ancestors)
export function ancestorsOf<T extends PageNode>(pages: readonly T[], id: string): T[] {
  const byId = indexById(pages);
  const page = byId.get(id);
  if (!page) return [];
  const seen = new Set<string>([id]);
  const out: T[] = [];
  let pid = effectiveParentId(page, byId);
  while (pid !== null && !seen.has(pid)) {
    const parent = byId.get(pid) as T;
    out.push(parent);
    seen.add(pid);
    pid = effectiveParentId(parent, byId);
  }
  return out.reverse();
}

/**
 * Every page below `id`, in tree order (pre-order, siblings sorted), excluding `id`
 * itself — what a delete takes with it (PageDetail.descendantCount, RD-056). Unknown id: [].
 */
// spec: docs/specs/09-decision-log.md section RD-056 (deleting takes the subtree)
export function descendantIds(pages: readonly PageNode[], id: string): string[] {
  const byId = indexById(pages);
  if (!byId.has(id)) return [];
  const children = childrenIndex(byId);
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack: string[] = [...(children.get(id) ?? [])].reverse().map((p) => p.id);
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    const kids = children.get(cur) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push((kids[i] as PageNode).id);
  }
  return out;
}

/**
 * Would making `newParentId` the parent of `id` put `id` under itself? True for the page
 * itself and for any descendant. Also true — conservatively — when the chain above
 * `newParentId` already loops, because the page would then never reach a root (the
 * database trigger refuses that too). An unknown `newParentId` is not a cycle; planMove
 * reports it as UNKNOWN_PARENT.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (cannot be moved under itself or a descendant)
export function wouldCreateCycle(pages: readonly PageNode[], id: string, newParentId: string | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  const byId = indexById(pages);
  const seen = new Set<string>();
  let cur: string | null = newParentId;
  while (cur !== null) {
    if (cur === id || seen.has(cur)) return true;
    seen.add(cur);
    const page = byId.get(cur);
    if (!page) return false;
    cur = effectiveParentId(page, byId);
  }
  return false;
}

function clampIndex(index: number, length: number): number {
  if (Number.isNaN(index)) return length;
  return Math.min(Math.max(Math.floor(index), 0), length);
}

/**
 * Plans a move as the rows to update. `index` is the 0-based position among the new
 * siblings with the moved page left out, rounded down and clamped into [0, count]; a
 * non-number index (NaN) appends. Both affected sibling lists are renumbered densely 0..n-1 in sibling
 * order, which also repairs any gap or duplicate already there. `changes` lists only rows
 * whose parentId or ordinal actually changes; a page other than the moved one keeps its
 * stored parentId. Checks run in the order UNKNOWN_PAGE, UNKNOWN_PARENT, CYCLE.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (moving; dense ordinal); docs/specs/08-api-surface.md section 3 (POST /pages/{id}/move)
export function planMove<T extends PageNode>(request: MoveRequest<T>): MovePlan {
  const { pages, id, parentId, index } = request;
  const byId = indexById(pages);
  const page = byId.get(id);
  if (!page) return { ok: false, reason: "UNKNOWN_PAGE" };
  if (parentId !== null && !byId.has(parentId)) return { ok: false, reason: "UNKNOWN_PARENT" };
  if (wouldCreateCycle(pages, id, parentId)) return { ok: false, reason: "CYCLE" };

  const children = childrenIndex(byId);
  const oldParent = effectiveParentId(page, byId);
  const without = (key: string | null) => (children.get(key) ?? []).filter((p) => p.id !== id);

  const oldSiblings = without(oldParent);
  const newSiblings = oldParent === parentId ? oldSiblings : without(parentId);
  newSiblings.splice(clampIndex(index, newSiblings.length), 0, page);

  const changes: PlannedChange[] = [];
  const renumber = (list: readonly T[]) => {
    list.forEach((p, ordinal) => {
      const nextParent = p.id === id ? parentId : p.parentId;
      if (p.ordinal !== ordinal || p.parentId !== nextParent) changes.push({ id: p.id, parentId: nextParent, ordinal });
    });
  };
  renumber(newSiblings);
  if (oldParent !== parentId) renumber(oldSiblings);
  return { ok: true, changes };
}
