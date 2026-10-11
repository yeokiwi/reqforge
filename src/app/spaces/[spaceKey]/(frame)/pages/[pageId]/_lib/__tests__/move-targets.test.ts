// Where the Move dialog may put a page (RD-056): never under itself or any descendant, at any
// depth; the top level is always a choice; the request's index puts the page last (RD-067).
import { describe, expect, it } from "vitest";
import { planMove, type PageNode } from "@/domain/documents/tree";
import { appendIndex, filterMoveTargets, moveBodyFor, moveTargets } from "../move-targets";

const page = (id: string, parentId: string | null, ordinal: number, title = id): PageNode => ({ id, parentId, ordinal, title });

//  A
//  ├─ B                 ← the page being moved (in most tests)
//  │  ├─ C
//  │  │  └─ D
//  │  │     └─ E
//  │  │        └─ F     (six levels deep)
//  │  └─ G
//  │     └─ H
//  └─ I
//     └─ J
//  K
const TREE: readonly PageNode[] = [
  page("A", null, 0),
  page("B", "A", 0),
  page("C", "B", 0),
  page("D", "C", 0),
  page("E", "D", 0),
  page("F", "E", 0),
  page("G", "B", 1),
  page("H", "G", 0),
  page("I", "A", 1),
  page("J", "I", 0),
  page("K", null, 1),
];

const ids = (targets: readonly { parentId: string | null }[]) => targets.map((t) => t.parentId);

describe("moveTargets — what the Move dialog offers", () => {
  it("leaves out the page and every descendant, however deep, and keeps everything else in tree order", () => {
    const targets = moveTargets(TREE, "B", "A");
    expect(ids(targets)).toEqual([null, "A", "I", "J", "K"]);
    for (const excluded of ["B", "C", "D", "E", "F", "G", "H"]) expect(ids(targets)).not.toContain(excluded);
  });

  it("offers the top level first, always", () => {
    for (const id of ["A", "B", "F", "K"]) {
      const first = moveTargets(TREE, id, null)[0];
      expect(first).toEqual({ parentId: null, title: "", depth: 0, path: [], current: true });
    }
  });

  it("a leaf deep down excludes only itself; its ancestors stay offered", () => {
    expect(ids(moveTargets(TREE, "F", "E"))).toEqual([null, "A", "B", "C", "D", "E", "G", "H", "I", "J", "K"]);
  });

  it("moving a root takes its whole tree out of the list", () => {
    expect(ids(moveTargets(TREE, "A", null))).toEqual([null, "K"]);
  });

  it("a one-page space offers only the top level, which is where the page already is", () => {
    const targets = moveTargets([page("only", null, 0)], "only", null);
    expect(targets).toEqual([{ parentId: null, title: "", depth: 0, path: [], current: true }]);
  });

  it("marks the page's present parent as current, and only it", () => {
    const targets = moveTargets(TREE, "J", "I");
    expect(targets.filter((t) => t.current).map((t) => t.parentId)).toEqual(["I"]);
    expect(targets[0]?.current).toBe(false);
  });

  it("gives each target its depth and the titles above it", () => {
    const targets = moveTargets(TREE, "K", null);
    expect(targets.find((t) => t.parentId === "F")).toMatchObject({ depth: 5, path: ["A", "B", "C", "D", "E"] });
    expect(targets.find((t) => t.parentId === "A")).toMatchObject({ depth: 0, path: [] });
  });

  it("orders siblings by ordinal, not by the order of the list", () => {
    const shuffled = [page("z", null, 1, "Zeta"), page("a", null, 0, "Alpha"), page("m", "a", 1, "Mid"), page("l", "a", 0, "Low")];
    expect(moveTargets(shuffled, "z", null).map((t) => t.title)).toEqual(["", "Alpha", "Low", "Mid"]);
  });

  it("an unknown page (a stale list) excludes nothing but itself", () => {
    expect(ids(moveTargets(TREE, "gone", "A"))).toEqual([null, "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]);
  });

  it("is safe on a list with a cycle (corrupt or mid-change): nothing under the page is offered", () => {
    // X → Y → X loop, with the page P hanging under Y.
    const looped = [page("X", "Y", 0), page("Y", "X", 0), page("P", "Y", 1), page("Q", null, 0)];
    const targets = moveTargets(looped, "P", "Y");
    for (const target of targets) {
      if (target.parentId === null) continue;
      const plan = planMove({ pages: looped, id: "P", parentId: target.parentId, index: 0 });
      expect(plan.ok, `offered ${target.parentId}`).toBe(true);
    }
    expect(ids(targets)).toContain("Q");
  });

  it("handles a chain far deeper than the call stack", () => {
    const chain: PageNode[] = [];
    for (let i = 0; i < 20_000; i++) chain.push(page(`p${i}`, i === 0 ? null : `p${i - 1}`, 0));
    const targets = moveTargets(chain, "p10", "p9");
    expect(targets).toHaveLength(1 + 10);
    expect(targets.at(-1)).toMatchObject({ parentId: "p9", depth: 9, current: true, path: ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] });
  });

  it("every offered target is a move the domain would accept (no cycle), for every page of the tree", () => {
    for (const moving of TREE) {
      for (const target of moveTargets(TREE, moving.id, moving.parentId)) {
        const plan = planMove({ pages: TREE, id: moving.id, parentId: target.parentId, index: 0 });
        expect(plan.ok, `${moving.id} under ${String(target.parentId)}`).toBe(true);
      }
    }
  });
});

describe("filterMoveTargets", () => {
  const targets = moveTargets(
    [page("a", null, 0, "Product"), page("b", "a", 0, "Specifications"), page("c", "a", 1, "Glossary"), page("d", null, 1, "Team notes")],
    "d",
    null,
  );

  it("keeps everything for an empty or blank query", () => {
    expect(filterMoveTargets(targets, "")).toEqual(targets);
    expect(filterMoveTargets(targets, "   ")).toEqual(targets);
  });

  it("matches titles case-insensitively and always keeps the top level", () => {
    expect(filterMoveTargets(targets, "SPEC").map((t) => t.title)).toEqual(["", "Specifications"]);
    expect(filterMoveTargets(targets, "OS").map((t) => t.title)).toEqual(["", "Glossary"]);
    expect(filterMoveTargets(targets, "  duct ").map((t) => t.title)).toEqual(["", "Product"]);
  });

  it("matching nothing leaves only the top level", () => {
    expect(filterMoveTargets(targets, "zzz").map((t) => t.parentId)).toEqual([null]);
  });
});

describe("appendIndex / moveBodyFor — the request puts the page last", () => {
  it("counts the new parent's children", () => {
    expect(appendIndex(TREE, "K", "B")).toBe(2);
    expect(appendIndex(TREE, "K", "F")).toBe(0);
    expect(moveBodyFor(TREE, "K", "A")).toEqual({ parentId: "A", index: 2 });
  });

  it("at the top level, does not count the moved page itself", () => {
    expect(appendIndex(TREE, "J", null)).toBe(2);
    expect(appendIndex(TREE, "K", null)).toBe(1);
    expect(moveBodyFor(TREE, "J", null)).toEqual({ parentId: null, index: 2 });
  });

  it("an unknown parent (stale list) gives 0; the server decides", () => {
    expect(appendIndex(TREE, "K", "nope")).toBe(0);
  });

  it("the index lands the page last in the domain's own plan", () => {
    for (const parentId of [null, "A", "B", "I"] as const) {
      const index = appendIndex(TREE, "J", parentId);
      const plan = planMove({ pages: TREE, id: "J", parentId, index });
      if (!plan.ok) throw new Error(`refused: ${plan.reason}`);
      // Under its present parent the plan is a no-op (RD-074) and J keeps its ordinal.
      const moved = plan.changes.find((c) => c.id === "J");
      expect(moved?.ordinal ?? TREE.find((p) => p.id === "J")?.ordinal, `under ${String(parentId)}`).toBe(index);
      const siblings = TREE.filter((p) => p.parentId === parentId && p.id !== "J");
      expect(index).toBe(siblings.length);
    }
  });
});
