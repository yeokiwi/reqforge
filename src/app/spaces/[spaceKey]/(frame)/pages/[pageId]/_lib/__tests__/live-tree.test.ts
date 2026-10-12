// The page's place in the frame's live tree: what the Move dialog marks as `Current` and what the
// breadcrumb lists, with the render's PageDetail only as the fallback for a page the tree lacks.
import { describe, expect, it } from "vitest";
import type { PageSummary } from "@/domain/documents";
import { buildModel } from "@/ui/page-tree/model";
import { liveAncestors, liveParentId } from "../live-tree";
import { pageDetail } from "./fixtures";

const summary = (id: string, title: string, parentId: string | null, ordinal: number): PageSummary => ({
  id,
  title,
  parentId,
  ordinal,
  currentVersion: 1,
  lastModifiedAt: "2026-10-01T08:00:00.000Z",
});

// Root (a) › Middle (b) › Specifications (p1); Other (c) at the top level.
const TREE = [summary("a", "Root", null, 0), summary("b", "Middle", "a", 0), summary("p1", "Specifications", "b", 0), summary("c", "Other", null, 1)];

describe("liveParentId", () => {
  it("is the live tree's parent, whatever the render said", () => {
    expect(liveParentId(TREE, pageDetail({ parentId: "c" }))).toBe("b");
    const atTop = TREE.map((p) => (p.id === "p1" ? { ...p, parentId: null } : p));
    expect(liveParentId(atTop, pageDetail({ parentId: "b" }))).toBeNull();
  });

  it("is the render's parent when the live tree does not have the page", () => {
    expect(liveParentId([], pageDetail({ parentId: "p0" }))).toBe("p0");
    expect(liveParentId(TREE.slice(0, 2), pageDetail({ parentId: null }))).toBeNull();
  });
});

describe("liveAncestors", () => {
  it("lists the ancestors root first, the page left out, with the live titles", () => {
    expect(liveAncestors(buildModel(TREE), "p1")).toEqual([
      { id: "a", title: "Root" },
      { id: "b", title: "Middle" },
    ]);
  });

  it("is empty for a top-level page", () => {
    expect(liveAncestors(buildModel(TREE), "c")).toEqual([]);
  });

  it("follows a move: under Other now", () => {
    const moved = TREE.map((p) => (p.id === "p1" ? { ...p, parentId: "c" } : p));
    expect(liveAncestors(buildModel(moved), "p1")).toEqual([{ id: "c", title: "Other" }]);
  });

  it("is null when the live tree does not have the page (the render's crumbs are shown)", () => {
    expect(liveAncestors(buildModel([]), "p1")).toBeNull();
    expect(liveAncestors(buildModel(TREE), "nope")).toBeNull();
  });
});
