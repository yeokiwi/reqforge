import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type PageNode,
  type PlannedChange,
  type TreeNode,
  ancestorsOf,
  buildTree,
  descendantIds,
  planMove,
  wouldCreateCycle,
} from "@/domain/documents";

// RD-056: a page tree with dense sibling ordinals; moving reparents and reorders within the
// space; a page cannot be moved under itself or a descendant.

const page = (id: string, parentId: string | null, ordinal: number, title = id.toUpperCase()): PageNode => ({
  id,
  parentId,
  ordinal,
  title,
});

//  a            b
//  ├─ a1        └─ b1
//  │  └─ a1x
//  ├─ a2
//  └─ a3
const SPACE: PageNode[] = [
  page("b", null, 1),
  page("a2", "a", 1),
  page("a", null, 0),
  page("a1x", "a1", 0),
  page("a3", "a", 2),
  page("a1", "a", 0),
  page("b1", "b", 0),
];

const shape = <T extends PageNode>(nodes: TreeNode<T>[]): unknown =>
  nodes.map((n) => (n.children.length ? { [n.page.id]: shape(n.children) } : n.page.id));

const flatten = <T extends PageNode>(nodes: TreeNode<T>[]): T[] => nodes.flatMap((n) => [n.page, ...flatten(n.children)]);

function apply(pages: readonly PageNode[], changes: readonly PlannedChange[]): PageNode[] {
  const byId = new Map(changes.map((c) => [c.id, c]));
  return pages.map((p) => {
    const c = byId.get(p.id);
    return c ? { ...p, parentId: c.parentId, ordinal: c.ordinal } : p;
  });
}

const siblingsOf = (pages: readonly PageNode[], parentId: string | null) =>
  pages.filter((p) => p.parentId === parentId).sort((x, y) => x.ordinal - y.ordinal);

const order = (pages: readonly PageNode[], parentId: string | null) => siblingsOf(pages, parentId).map((p) => p.id);

function move(pages: readonly PageNode[], id: string, parentId: string | null, index: number) {
  const plan = planMove({ pages, id, parentId, index });
  if (!plan.ok) throw new Error(`expected a plan, got ${plan.reason}`);
  return { changes: plan.changes, after: apply(pages, plan.changes) };
}

describe("buildTree", () => {
  it("nests pages and orders siblings by ordinal", () => {
    expect(shape(buildTree(SPACE))).toEqual([{ a: [{ a1: ["a1x"] }, "a2", "a3"] }, { b: ["b1"] }]);
  });

  it("records depth", () => {
    const [a] = buildTree(SPACE);
    expect(a?.depth).toBe(0);
    expect(a?.children[0]?.depth).toBe(1);
    expect(a?.children[0]?.children[0]?.depth).toBe(2);
  });

  it("breaks ordinal ties by title, then by id", () => {
    const pages = [page("z", null, 0, "Same"), page("y", null, 0, "Alpha"), page("x", null, 0, "Same")];
    expect(shape(buildTree(pages))).toEqual(["y", "x", "z"]);
  });

  it("makes a page whose parent is missing a root", () => {
    const pages = [page("orphan", "gone", 0), page("r", null, 0)];
    expect(shape(buildTree(pages))).toEqual(["orphan", "r"]);
  });

  it("keeps the extra fields of a subtype", () => {
    const pages = [{ ...page("r", null, 0), currentVersion: 7 }];
    expect(buildTree(pages)[0]?.page.currentVersion).toBe(7);
  });

  it("terminates on a cycle and still shows every page once", () => {
    const pages = [page("p", "q", 0), page("q", "p", 0), page("c", "q", 0), page("self", "self", 0)];
    const flat = flatten(buildTree(pages)).map((p) => p.id);
    expect(flat.sort()).toEqual(["c", "p", "q", "self"]);
  });

  it("returns an empty forest for no pages and ignores a duplicated id", () => {
    expect(buildTree([])).toEqual([]);
    expect(flatten(buildTree([page("r", null, 0), page("r", null, 5)])).map((p) => p.ordinal)).toEqual([0]);
  });

  it("builds a chain far deeper than the call stack", () => {
    // The database trigger bounds a new parent's ancestors, not the depth of the subtree
    // moved under it, so chains can be stacked deeper than native recursion can go.
    const depth = 50_000;
    const pages = Array.from({ length: depth }, (_, i) => page(`n${i}`, i === 0 ? null : `n${i - 1}`, 0));
    expect(chainOf(buildTree(pages.slice().reverse()))).toEqual(pages.map((p, i) => [p.id, i]));
  });

  it("builds a cycle far deeper than the call stack, starting at its first member", () => {
    const depth = 50_000;
    const pages = Array.from({ length: depth }, (_, i) => page(`n${i}`, `n${(i + depth - 1) % depth}`, 0));
    // Sibling order compares titles by code unit: "N0" is the cycle's first member.
    expect(chainOf(buildTree(pages))).toEqual(pages.map((p, i) => [p.id, i]));
  });
});

/** A forest that must be one chain, walked without recursion, as [id, depth] pairs. */
function chainOf<T extends PageNode>(forest: TreeNode<T>[]): Array<[string, number]> {
  expect(forest).toHaveLength(1);
  const out: Array<[string, number]> = [];
  for (let node = forest[0]; node !== undefined; node = node.children[0]) {
    if (node.children.length > 1) throw new Error(`${node.page.id} has ${node.children.length} children`);
    out.push([node.page.id, node.depth]);
  }
  return out;
}

describe("ancestorsOf", () => {
  it("lists ancestors root first, excluding the page", () => {
    expect(ancestorsOf(SPACE, "a1x").map((p) => p.id)).toEqual(["a", "a1"]);
    expect(ancestorsOf(SPACE, "a")).toEqual([]);
  });

  it("answers [] for an unknown page and stops at a missing parent or a cycle", () => {
    expect(ancestorsOf(SPACE, "nope")).toEqual([]);
    expect(ancestorsOf([page("x", "gone", 0)], "x")).toEqual([]);
    expect(ancestorsOf([page("p", "q", 0), page("q", "p", 0)], "p").map((p) => p.id)).toEqual(["q"]);
  });
});

describe("descendantIds", () => {
  it("lists the subtree in tree order, excluding the page", () => {
    expect(descendantIds(SPACE, "a")).toEqual(["a1", "a1x", "a2", "a3"]);
    expect(descendantIds(SPACE, "a1x")).toEqual([]);
    expect(descendantIds(SPACE, "nope")).toEqual([]);
  });

  it("terminates on a cycle and never lists the page itself", () => {
    expect(descendantIds([page("p", "q", 0), page("q", "p", 0)], "p")).toEqual(["q"]);
  });
});

describe("wouldCreateCycle", () => {
  it("refuses the page itself and every descendant", () => {
    expect(wouldCreateCycle(SPACE, "a", "a")).toBe(true);
    expect(wouldCreateCycle(SPACE, "a", "a1")).toBe(true);
    expect(wouldCreateCycle(SPACE, "a", "a1x")).toBe(true);
  });

  it("allows the root, a sibling, an ancestor and another branch", () => {
    expect(wouldCreateCycle(SPACE, "a1x", null)).toBe(false);
    expect(wouldCreateCycle(SPACE, "a1", "a2")).toBe(false);
    expect(wouldCreateCycle(SPACE, "a1x", "a")).toBe(false);
    expect(wouldCreateCycle(SPACE, "a", "b1")).toBe(false);
  });

  it("is conservative above an existing cycle and false for an unknown parent", () => {
    expect(wouldCreateCycle([page("p", "q", 0), page("q", "p", 0), page("x", null, 0)], "x", "p")).toBe(true);
    expect(wouldCreateCycle(SPACE, "a", "nope")).toBe(false);
  });
});

describe("planMove", () => {
  it("reports an unknown page, an unknown parent, and a cycle, in that order", () => {
    expect(planMove({ pages: SPACE, id: "nope", parentId: "nope", index: 0 })).toEqual({ ok: false, reason: "UNKNOWN_PAGE" });
    expect(planMove({ pages: SPACE, id: "a", parentId: "nope", index: 0 })).toEqual({ ok: false, reason: "UNKNOWN_PARENT" });
    expect(planMove({ pages: SPACE, id: "a", parentId: "a1x", index: 0 })).toEqual({ ok: false, reason: "CYCLE" });
    expect(planMove({ pages: SPACE, id: "a", parentId: "a", index: 0 })).toEqual({ ok: false, reason: "CYCLE" });
  });

  it("moves to another parent and renumbers both sibling lists", () => {
    const { changes, after } = move(SPACE, "a1", "b", 0);
    expect(order(after, "b")).toEqual(["a1", "b1"]);
    expect(order(after, "a")).toEqual(["a2", "a3"]);
    expect(siblingsOf(after, "a").map((p) => p.ordinal)).toEqual([0, 1]);
    expect(siblingsOf(after, "b").map((p) => p.ordinal)).toEqual([0, 1]);
    expect(changes).toEqual([
      { id: "a1", parentId: "b", ordinal: 0 },
      { id: "b1", parentId: "b", ordinal: 1 },
      { id: "a2", parentId: "a", ordinal: 0 },
      { id: "a3", parentId: "a", ordinal: 1 },
    ]);
  });

  it("moves to the root", () => {
    const { after } = move(SPACE, "a1x", null, 1);
    expect(order(after, null)).toEqual(["a", "a1x", "b"]);
    expect(order(after, "a1")).toEqual([]);
  });

  it("clamps an index past the end to the end, and a negative one to the start", () => {
    expect(order(move(SPACE, "b1", "a", 99).after, "a")).toEqual(["a1", "a2", "a3", "b1"]);
    expect(order(move(SPACE, "b1", "a", -5).after, "a")).toEqual(["b1", "a1", "a2", "a3"]);
    expect(order(move(SPACE, "b1", "a", Number.POSITIVE_INFINITY).after, "a")).toEqual(["a1", "a2", "a3", "b1"]);
    expect(order(move(SPACE, "b1", "a", Number.NaN).after, "a")).toEqual(["a1", "a2", "a3", "b1"]);
  });

  it("rounds a fractional index down", () => {
    expect(order(move(SPACE, "b1", "a", 0.5).after, "a")).toEqual(["b1", "a1", "a2", "a3"]);
    expect(order(move(SPACE, "b1", "a", 2.999).after, "a")).toEqual(["a1", "a2", "b1", "a3"]);
    expect(order(move(SPACE, "b1", "a", -0.5).after, "a")).toEqual(["b1", "a1", "a2", "a3"]);
  });

  it("reorders within the same parent without leaving a gap or a duplicate", () => {
    // index counts positions among the siblings with the moved page left out.
    const down = move(SPACE, "a1", "a", 2);
    expect(order(down.after, "a")).toEqual(["a2", "a3", "a1"]);
    expect(siblingsOf(down.after, "a").map((p) => p.ordinal)).toEqual([0, 1, 2]);
    expect(down.changes).toEqual([
      { id: "a2", parentId: "a", ordinal: 0 },
      { id: "a3", parentId: "a", ordinal: 1 },
      { id: "a1", parentId: "a", ordinal: 2 },
    ]);

    const up = move(SPACE, "a3", "a", 0);
    expect(order(up.after, "a")).toEqual(["a3", "a1", "a2"]);
    expect(siblingsOf(up.after, "a").map((p) => p.ordinal)).toEqual([0, 1, 2]);

    const middle = move(SPACE, "a1", "a", 1);
    expect(order(middle.after, "a")).toEqual(["a2", "a1", "a3"]);
  });

  it("returns no changes for a move to where the page already is", () => {
    expect(planMove({ pages: SPACE, id: "a2", parentId: "a", index: 1 })).toEqual({ ok: true, changes: [] });
  });

  it("repairs gaps and duplicates in the affected lists", () => {
    const messy = [page("r", null, 0), page("x", "r", 0), page("y", "r", 0), page("z", "r", 7), page("w", null, 3)];
    const { after } = move(messy, "w", "r", 1);
    expect(siblingsOf(after, "r").map((p) => [p.id, p.ordinal])).toEqual([
      ["x", 0],
      ["w", 1],
      ["y", 2],
      ["z", 3],
    ]);
  });

  it("moves a page whose stored parent is missing, and renumbers siblings without reparenting them", () => {
    const pages = [page("orphan", "gone", 0), page("r", null, 0), page("ghost2", "gone", 1)];
    // Root siblings without the orphan: r (0), ghost2 (1). Insert at the front.
    expect(planMove({ pages, id: "orphan", parentId: null, index: 0 })).toEqual({
      ok: true,
      changes: [
        { id: "orphan", parentId: null, ordinal: 0 },
        { id: "r", parentId: null, ordinal: 1 },
        { id: "ghost2", parentId: "gone", ordinal: 2 },
      ],
    });
    // At the end only the orphan's parent changes.
    expect(planMove({ pages, id: "orphan", parentId: null, index: 2 })).toEqual({
      ok: true,
      changes: [{ id: "orphan", parentId: null, ordinal: 2 }],
    });
  });
});

// ---- properties ---------------------------------------------------------------------------

/** A valid space: page i's parent is null or a page created before it; ordinals dense. */
const validTree = fc
  .array(fc.tuple(fc.nat(), fc.string({ maxLength: 3 })), { minLength: 1, maxLength: 25 })
  .map((specs) => {
    const counts = new Map<string | null, number>();
    return specs.map(([pick, title], i): PageNode => {
      const choice = pick % (i + 1); // 0 = root, k = page k-1
      const parentId = choice === 0 ? null : `p${choice - 1}`;
      const ordinal = counts.get(parentId) ?? 0;
      counts.set(parentId, ordinal + 1);
      return { id: `p${i}`, parentId, ordinal, title };
    });
  });

const moveCase = validTree.chain((pages) =>
  fc.record({
    pages: fc.shuffledSubarray(pages, { minLength: pages.length, maxLength: pages.length }),
    id: fc.constantFrom(...pages.map((p) => p.id)),
    parentId: fc.option(fc.constantFrom(...pages.map((p) => p.id)), { freq: 3 }),
    index: fc.integer({ min: -2, max: pages.length + 2 }),
  }),
);

function reachesRoot(pages: readonly PageNode[], id: string): boolean {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur !== null) {
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return true;
}

function denseEverywhere(pages: readonly PageNode[]): boolean {
  const parents = new Set(pages.map((p) => p.parentId));
  return [...parents].every((parent) =>
    siblingsOf(pages, parent).every((p, i) => p.ordinal === i),
  );
}

describe("planMove properties", () => {
  it("is refused exactly when it would create a cycle, and otherwise never creates one", () => {
    fc.assert(
      fc.property(moveCase, ({ pages, id, parentId, index }) => {
        const plan = planMove({ pages, id, parentId, index });
        const cyclic = wouldCreateCycle(pages, id, parentId);
        expect(plan.ok).toBe(!cyclic);
        if (!plan.ok) {
          expect(plan.reason).toBe("CYCLE");
          return;
        }
        const after = apply(pages, plan.changes);
        for (const p of after) expect(reachesRoot(after, p.id)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps every sibling list dense and duplicate-free and puts the page where asked", () => {
    fc.assert(
      fc.property(moveCase, ({ pages, id, parentId, index }) => {
        const plan = planMove({ pages, id, parentId, index });
        if (!plan.ok) return;
        const after = apply(pages, plan.changes);
        expect(denseEverywhere(after)).toBe(true);
        const moved = after.find((p) => p.id === id) as PageNode;
        expect(moved.parentId).toBe(parentId);
        const newSiblingCount = after.filter((p) => p.parentId === parentId).length - 1;
        expect(moved.ordinal).toBe(Math.min(Math.max(index, 0), newSiblingCount));
      }),
      { numRuns: 500 },
    );
  });

  it("touches only the moved page and its old and new siblings, and only rows that change", () => {
    fc.assert(
      fc.property(moveCase, ({ pages, id, parentId, index }) => {
        const plan = planMove({ pages, id, parentId, index });
        if (!plan.ok) return;
        const before = new Map(pages.map((p) => [p.id, p]));
        const oldParent = (before.get(id) as PageNode).parentId;
        const ids = plan.changes.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of plan.changes) {
          const was = before.get(c.id) as PageNode;
          expect(c.id === id || was.parentId === oldParent || was.parentId === parentId).toBe(true);
          expect(was.ordinal !== c.ordinal || was.parentId !== c.parentId).toBe(true);
          if (c.id !== id) expect(c.parentId).toBe(was.parentId);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("leaves a tree in which buildTree shows every page exactly once", () => {
    fc.assert(
      fc.property(moveCase, ({ pages, id, parentId, index }) => {
        const plan = planMove({ pages, id, parentId, index });
        if (!plan.ok) return;
        const after = apply(pages, plan.changes);
        const shown = flatten(buildTree(after)).map((p) => p.id);
        expect(shown.slice().sort()).toEqual(pages.map((p) => p.id).sort());
        // A real tree: depth-first order agrees with ancestorsOf for every page.
        const placed = new Set<string>();
        for (const pid of shown) {
          for (const anc of ancestorsOf(after, pid)) expect(placed.has(anc.id)).toBe(true);
          placed.add(pid);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("descendantIds and wouldCreateCycle agree", () => {
    fc.assert(
      fc.property(moveCase, ({ pages, id, parentId }) => {
        const below = new Set(descendantIds(pages, id));
        const expected = parentId === id || (parentId !== null && below.has(parentId));
        expect(wouldCreateCycle(pages, id, parentId)).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });
});

describe("buildTree properties", () => {
  it("terminates and shows every distinct page exactly once, whatever the parent links", () => {
    const arbitraryLinks = fc
      .array(fc.tuple(fc.nat({ max: 12 }), fc.integer({ min: -3, max: 12 }), fc.integer({ min: -1, max: 4 })), {
        maxLength: 14,
      })
      .map((rows) =>
        rows.map(([i, parent, ordinal]): PageNode => ({
          id: `n${i}`,
          parentId: parent < 0 ? (parent === -1 ? null : `missing${parent}`) : `n${parent}`,
          ordinal,
          title: "",
        })),
      );
    fc.assert(
      fc.property(arbitraryLinks, (pages) => {
        const shown = flatten(buildTree(pages)).map((p) => p.id);
        expect(shown.slice().sort()).toEqual([...new Set(pages.map((p) => p.id))].sort());
      }),
      { numRuns: 500 },
    );
  });
});
