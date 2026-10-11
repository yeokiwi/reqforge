// The page tree's pure logic: visible rows, auto-expansion paths, the move a drop or a key asks
// for, and drop validity (10 §3.2, RD-056).
import { describe, expect, it } from "vitest";
import { planMove } from "@/domain/documents";
import {
  ancestorIds,
  applyMove,
  buildModel,
  currentPageIdFromPath,
  editHref,
  isNoopMove,
  moveForDrop,
  moveForKey,
  pageHref,
  parsePages,
  positionOf,
  samePages,
  toPageSummary,
  visibleIds,
  visibleRepresentative,
  zoneFor,
} from "../model";
import { page, sampleTree } from "./fake-api";

const model = () => buildModel(sampleTree());
const openSet = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};

describe("buildModel", () => {
  it("nests pages by parent and orders siblings by ordinal (RD-056)", () => {
    const m = buildModel([page("b", "B", null, 1), page("a", "A", null, 0), page("a2", "A2", "a", 1), page("a1", "A1", "a", 0)]);
    expect(m.rootIds).toEqual(["a", "b"]);
    expect(m.nodes.get("a")?.childIds).toEqual(["a1", "a2"]);
    expect(m.nodes.get("a1")?.parentId).toBe("a");
  });

  it("treats a page whose parent is missing as a root, so nothing disappears", () => {
    const m = buildModel([page("x", "X", "gone", 0), page("r", "R", null, 0)]);
    expect(new Set(m.rootIds)).toEqual(new Set(["x", "r"]));
    expect(m.nodes.get("x")?.parentId).toBeNull();
  });

  it("keeps unchanged nodes and child lists as the same objects (what lets rows skip re-rendering)", () => {
    const first = model();
    const renamed = sampleTree().map((p) => (p.id === "n" ? { ...p, title: "Notes, renamed" } : p));
    const second = buildModel(renamed, first);
    expect(second.nodes.get("h")).toBe(first.nodes.get("h"));
    expect(second.nodes.get("m")).toBe(first.nodes.get("m"));
    expect(second.nodes.get("t1a")).toBe(first.nodes.get("t1a")); // its child list did not change
    expect(second.nodes.get("n")).not.toBe(first.nodes.get("n"));
    expect(second.rootIds).toBe(first.rootIds);
  });

  it("builds a 1,000-level chain without overflowing the stack (RD-070)", () => {
    const chain = Array.from({ length: 1000 }, (_, i) => page(`c${i}`, `C${i}`, i === 0 ? null : `c${i - 1}`, 0));
    const m = buildModel(chain);
    expect(m.rootIds).toEqual(["c0"]);
    expect(ancestorIds(m, "c999")).toHaveLength(999);
  });
});

describe("visible rows", () => {
  it("lists roots only while everything is closed", () => {
    expect(visibleIds(model(), openSet())).toEqual(["s", "team"]);
  });

  it("flattens depth-first, children right under their open parent", () => {
    expect(visibleIds(model(), openSet("s", "t1a"))).toEqual(["s", "h", "t1", "t1a", "n", "team"]);
  });

  it("hides the children of a closed page even when they are themselves open", () => {
    expect(visibleIds(model(), openSet("t1a"))).toEqual(["s", "team"]);
  });

  it("a hidden page is represented by its highest closed ancestor", () => {
    expect(visibleRepresentative(model(), "n", openSet())).toBe("s");
    expect(visibleRepresentative(model(), "n", openSet("s"))).toBe("t1a");
    expect(visibleRepresentative(model(), "n", openSet("s", "t1a"))).toBe("n");
    expect(visibleRepresentative(model(), "nope", openSet())).toBeNull();
  });
});

describe("auto-expansion of the current page's ancestors (10 §3.2)", () => {
  it("is the path from the root, excluding the page", () => {
    expect(ancestorIds(model(), "n")).toEqual(["s", "t1a"]);
    expect(ancestorIds(model(), "s")).toEqual([]);
    expect(ancestorIds(model(), "unknown")).toEqual([]);
  });

  it("reads the current page from the pathname, for this space only", () => {
    expect(currentPageIdFromPath("/spaces/TEAM/pages/p1", "TEAM")).toBe("p1");
    expect(currentPageIdFromPath("/spaces/team/pages/p1/history/compare", "TEAM")).toBe("p1");
    expect(currentPageIdFromPath("/spaces/TEAM", "TEAM")).toBeNull();
    expect(currentPageIdFromPath("/spaces/OTHER/pages/p1", "TEAM")).toBeNull();
    expect(currentPageIdFromPath("/requirements/TEAM", "TEAM")).toBeNull();
    expect(currentPageIdFromPath("/spaces/TEAM/pages/%E0%A4%A", "TEAM")).toBeNull();
    expect(currentPageIdFromPath(null, "TEAM")).toBeNull();
  });

  it("builds the spec's URLs, percent-encoded (10 §11)", () => {
    expect(pageHref("TEAM", "p1")).toBe("/spaces/TEAM/pages/p1");
    expect(editHref("TEAM", "a/b")).toBe("/spaces/TEAM/pages/a%2Fb/edit");
  });
});

describe("the move a drop asks for (10 §3.2: drag to reorder and re-parent)", () => {
  it("before / after a row: next to it, under the same parent", () => {
    expect(moveForDrop(model(), "h", "t1a", "before", false)).toEqual({ parentId: "s", index: 1 });
    expect(moveForDrop(model(), "h", "t1a", "after", false)).toEqual({ parentId: "s", index: 2 });
    expect(moveForDrop(model(), "m", "s", "after", false)).toEqual({ parentId: null, index: 1 });
  });

  it("onto a row: its last child", () => {
    expect(moveForDrop(model(), "m", "t1", "inside", false)).toEqual({ parentId: "t1", index: 0 });
    expect(moveForDrop(model(), "m", "s", "inside", true)).toEqual({ parentId: "s", index: 3 });
  });

  it("after an open page with children: its first child, where the line is drawn", () => {
    expect(moveForDrop(model(), "m", "s", "after", true)).toEqual({ parentId: "s", index: 0 });
    expect(moveForDrop(model(), "m", "s", "after", false)).toEqual({ parentId: null, index: 1 });
  });

  it("refuses a drop onto the page itself or any descendant, in every zone (RD-056)", () => {
    for (const zone of ["before", "inside", "after"] as const) {
      expect(moveForDrop(model(), "s", "s", zone, true), `self ${zone}`).toBeNull();
      expect(moveForDrop(model(), "s", "h", zone, true), `child ${zone}`).toBeNull();
      expect(moveForDrop(model(), "s", "n", zone, true), `grandchild ${zone}`).toBeNull();
      expect(moveForDrop(model(), "t1a", "n", zone, true), `own child ${zone}`).toBeNull();
    }
  });

  it("agrees with the domain's cycle rule wherever it refuses", () => {
    const m = model();
    for (const drag of m.nodes.keys()) {
      for (const target of m.nodes.keys()) {
        const move = moveForDrop(m, drag, target, "inside", true);
        const plan = planMove({ pages: m.pages, id: drag, parentId: target, index: 0 });
        if (!plan.ok && plan.reason === "CYCLE") expect(move, `${drag} into ${target}`).toBeNull();
      }
    }
  });

  it("sends nothing for a drop that leaves the page where it is", () => {
    expect(moveForDrop(model(), "t1", "h", "after", false)).toBeNull();
    expect(moveForDrop(model(), "h", "t1", "before", false)).toBeNull();
    expect(moveForDrop(model(), "n", "t1a", "inside", true)).toBeNull();
  });

  it("is null for unknown pages", () => {
    expect(moveForDrop(model(), "ghost", "s", "inside", false)).toBeNull();
    expect(moveForDrop(model(), "s", "ghost", "inside", false)).toBeNull();
  });

  it("splits a row in quarters: before, onto, after", () => {
    expect(zoneFor(0, 40)).toBe("before");
    expect(zoneFor(9.9, 40)).toBe("before");
    expect(zoneFor(10, 40)).toBe("inside");
    expect(zoneFor(29.9, 40)).toBe("inside");
    expect(zoneFor(30, 40)).toBe("after");
    expect(zoneFor(Number.NaN, 40)).toBe("inside");
    expect(zoneFor(5, 0)).toBe("inside");
  });
});

describe("the move a key asks for (the keyboard route to drag and drop)", () => {
  it("Alt+↑ / Alt+↓ swap with the previous / next sibling", () => {
    expect(moveForKey(model(), "t1", "up")).toEqual({ parentId: "s", index: 0 });
    expect(moveForKey(model(), "t1", "down")).toEqual({ parentId: "s", index: 2 });
    expect(moveForKey(model(), "h", "up")).toBeNull();
    expect(moveForKey(model(), "t1a", "down")).toBeNull();
  });

  it("Alt+Shift+→ makes it the last child of the page above", () => {
    expect(moveForKey(model(), "t1", "indent")).toEqual({ parentId: "h", index: 0 });
    expect(moveForKey(model(), "team", "indent")).toEqual({ parentId: "s", index: 3 });
    expect(moveForKey(model(), "h", "indent")).toBeNull();
  });

  it("Alt+Shift+← moves it up a level, right after its parent", () => {
    expect(moveForKey(model(), "n", "outdent")).toEqual({ parentId: "s", index: 3 });
    expect(moveForKey(model(), "h", "outdent")).toEqual({ parentId: null, index: 1 });
    expect(moveForKey(model(), "s", "outdent")).toBeNull();
  });

  it("each keyed move lands where the key says, by the server's own rule (planMove)", () => {
    const m = model();
    const after = (id: string, kind: "up" | "down" | "indent" | "outdent") => {
      const target = moveForKey(m, id, kind);
      if (target === null) throw new Error("no move");
      return buildModel(applyMove(m.pages, id, target));
    };
    expect(after("t1", "up").nodes.get("s")?.childIds).toEqual(["t1", "h", "t1a"]);
    expect(after("t1", "down").nodes.get("s")?.childIds).toEqual(["h", "t1a", "t1"]);
    expect(after("t1", "indent").nodes.get("h")?.childIds).toEqual(["t1"]);
    const outdented = after("n", "outdent");
    expect(outdented.nodes.get("s")?.childIds).toEqual(["h", "t1", "t1a", "n"]);
    expect(outdented.nodes.get("t1a")?.childIds).toEqual([]);
  });
});

describe("applyMove", () => {
  it("renumbers both affected sibling lists densely, as the server does (RD-056)", () => {
    const pages = applyMove(sampleTree(), "h", { parentId: "team", index: 0 });
    const byId = new Map(pages.map((p) => [p.id, p]));
    expect(byId.get("h")).toMatchObject({ parentId: "team", ordinal: 0 });
    expect(byId.get("m")).toMatchObject({ parentId: "team", ordinal: 1 });
    expect(byId.get("t1")?.ordinal).toBe(0);
    expect(byId.get("t1a")?.ordinal).toBe(1);
  });

  it("returns the same list for a refused move", () => {
    const pages = sampleTree();
    expect(applyMove(pages, "s", { parentId: "n", index: 0 })).toBe(pages);
  });

  it("knows a no-op when it sees one", () => {
    expect(isNoopMove(model(), "t1", { parentId: "s", index: 1 })).toBe(true);
    expect(isNoopMove(model(), "t1", { parentId: "s", index: 0 })).toBe(false);
  });
});

describe("positions and wire data", () => {
  it("gives a 1-based position for the announcement", () => {
    expect(positionOf(model(), "t1")).toEqual({ parentTitle: "Specifications", position: 2, count: 3 });
    expect(positionOf(model(), "team")).toEqual({ parentTitle: null, position: 2, count: 2 });
  });

  it("reads GET /pages' bare array and drops malformed entries (RD-072)", () => {
    expect(parsePages({ pages: [] })).toBeNull();
    expect(parsePages([page("a", "A"), { id: 1 }, null, { ...page("b", "B"), ordinal: "x" }])).toEqual([page("a", "A")]);
  });

  it("reads a PageDetail as a PageSummary", () => {
    expect(toPageSummary({ ...page("a", "A", "p", 2), spaceKey: "TEAM", ancestors: [] })).toEqual(page("a", "A", "p", 2));
    expect(toPageSummary("nope")).toBeNull();
  });

  it("compares lists field by field", () => {
    expect(samePages(sampleTree(), sampleTree())).toBe(true);
    const changed = sampleTree().map((p) => (p.id === "h" ? { ...p, currentVersion: 2 } : p));
    expect(samePages(sampleTree(), changed)).toBe(false);
  });
});
