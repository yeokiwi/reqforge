// What AppFrame and the space overview load for the page tree (10 §3.2, §11): the viewer's live
// tree, in the order the tree draws it, and an error state — never a thrown error — when it
// cannot be read.
// spec: docs/specs/08-api-surface.md section 3 (GET /pages); docs/specs/10-ui-reference.md sections 3.2 and 12; RD-051, RD-056
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deletePage, movePage } from "@/server/usecases/pages";
import { buildTree } from "@/test-support/documents-fixtures";
import { actorFor, resetDemoInstance } from "@/test-support/fixtures";
import { loadFrameTree, loadPageTree } from "../load-tree";

beforeEach(resetDemoInstance);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPageTree", () => {
  it("returns the live tree, flat, ordered by ordinal within parent (08 §3)", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Spec", children: [{ title: "Intro" }, { title: "Scope" }] }, { title: "Team notes" }]);
    const carol = await actorFor("carol"); // VIEW only: reading the tree needs no more
    const tree = await loadPageTree(carol, "team");
    expect(tree.status).toBe("ready");
    if (tree.status !== "ready") return;
    expect(tree.pages.map((p) => [p.title, p.parentId, p.ordinal])).toEqual([
      ["Spec", null, 0],
      ["Team notes", null, 1],
      ["Intro", ids.Spec, 0],
      ["Scope", ids.Spec, 1],
    ]);
  });

  it("reflects moves and leaves deleted subtrees out (RD-056)", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1" }] }, { title: "B" }]);
    const alice = await actorFor("alice");
    await movePage(alice, "TEAM", ids.B as string, { parentId: ids.A as string, index: 0 });
    await deletePage(alice, "TEAM", ids.A1 as string);
    const tree = await loadPageTree(alice, "TEAM");
    expect(tree.status === "ready" ? tree.pages.map((p) => [p.title, p.parentId, p.ordinal]) : null).toEqual([
      ["A", null, 0],
      ["B", ids.A, 0],
    ]);
  });

  it("is an error state, not a throw, for a space the viewer cannot see — and logs nothing for it (RD-051)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const carol = await actorFor("carol"); // no membership in PLAT
    expect(await loadPageTree(carol, "PLAT")).toEqual({ status: "error" });
    expect(await loadPageTree(carol, "NOPE")).toEqual({ status: "error" });
    expect(log).not.toHaveBeenCalled();
  });

  it("accepts the URL's key in any case, as the screens pass it", async () => {
    await buildTree("alice", "plat", [{ title: "Platform home" }]);
    const bob = await actorFor("bob"); // VIEW in PLAT through a group
    const tree = await loadPageTree(bob, "plat");
    expect(tree.status === "ready" ? tree.pages.map((p) => p.title) : null).toEqual(["Platform home"]);
  });

  it("is what loadFrameTree returns (the per-request memoised entry point)", async () => {
    await buildTree("alice", "team", [{ title: "Only" }]);
    const alice = await actorFor("alice");
    expect(await loadFrameTree(alice, "TEAM")).toEqual(await loadPageTree(alice, "TEAM"));
  });
});
