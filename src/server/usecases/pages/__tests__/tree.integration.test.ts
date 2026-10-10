// listPageTree, createPage, movePage, deletePage.
// spec: 08 §3 (GET/POST /pages, move, DELETE); RD-056 (tree rules), RD-061 (creator watches), RD-067, RD-070
import { beforeEach, describe, expect, it } from "vitest";
import { CycleError, ForbiddenError, NotFoundError, TitleTakenError, ValidationError } from "@/domain/errors";
import { emptyDocument } from "@/editor/schema";
import { createPage, deletePage, getPageView, listPageTree, movePage } from "@/server/usecases/pages";
import { buildTree, createPageAs } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";
import { PLAT, TEAM, actors, auditRows, expectError, type Actors } from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

describe("listPageTree", () => {
  it("lists the live tree flat, ordered by ordinal within parent, with the space", async () => {
    const ids = await buildTree("alice", "team", [{ title: "B", children: [{ title: "B1" }, { title: "B2" }] }, { title: "A" }]);
    const tree = await listPageTree(who.carol, "team");
    expect(tree.space.key).toBe(TEAM);
    expect(tree.pages.map((p) => [p.title, p.parentId, p.ordinal])).toEqual([
      ["B", null, 0],
      ["A", null, 1],
      ["B1", ids.B, 0],
      ["B2", ids.B, 1],
    ]);
    const first = tree.pages[0];
    expect(first?.currentVersion).toBe(1);
    expect(Number.isNaN(Date.parse(first?.lastModifiedAt ?? ""))).toBe(false);
  });

  it("is empty for a space without pages, and leaves deleted pages out", async () => {
    expect((await listPageTree(who.alice, PLAT)).pages).toEqual([]);
    const page = await createPageAs("alice", "team", { title: "Gone" });
    await deletePage(who.alice, TEAM, page.id);
    expect((await listPageTree(who.alice, TEAM)).pages).toEqual([]);
  });

  it("is NotFound for a space the caller cannot see, and for one that does not exist", async () => {
    await expectError(listPageTree(who.carol, PLAT), NotFoundError);
    await expectError(listPageTree(who.alice, "NOSUCH"), NotFoundError);
    await expectError(listPageTree(who.alice, "../x"), NotFoundError);
  });
});

describe("createPage", () => {
  it("makes the page immediately: an empty first version titled Untitled, watched by its creator, audited", async () => {
    const page = await createPage(who.bob, "team");
    expect(page).toMatchObject({
      title: "Untitled",
      parentId: null,
      ordinal: 0,
      currentVersion: 1,
      spaceKey: TEAM,
      ancestors: [],
      createdBy: { id: who.bob.id, name: who.bob.name },
      lastModifiedBy: { id: who.bob.id, name: who.bob.name },
      descendantCount: 0,
      watching: true,
      favourite: false,
      hasDraft: false,
      permissions: { canEdit: true, canAdmin: false },
    });
    const view = await getPageView(who.bob, TEAM, page.id);
    expect(view.version.content).toEqual(emptyDocument());
    expect(view.version.message).toBeNull();
    const [audit] = await auditRows(page.id);
    expect(audit).toMatchObject({ actorId: who.bob.id, objectType: "page", operation: "page.create" });
    expect(audit?.parameters).toMatchObject({ title: "Untitled", parentId: null, ordinal: 0, version: 1 });
  });

  it("numbers made-up titles: Untitled, Untitled 2, Untitled 3 — also when created concurrently", async () => {
    const created = await Promise.all([createPage(who.alice, TEAM), createPage(who.alice, TEAM), createPage(who.alice, TEAM)]);
    expect(created.map((p) => p.title).sort()).toEqual(["Untitled", "Untitled 2", "Untitled 3"]);
    expect(created.map((p) => p.ordinal).sort()).toEqual([0, 1, 2]);
  });

  it("skips a made-up title taken case-insensitively", async () => {
    await createPageAs("alice", "team", { title: "untitled" });
    expect((await createPage(who.alice, TEAM)).title).toBe("Untitled 2");
  });

  it("stores an explicit title normalised (NFC, trimmed)", async () => {
    const page = await createPage(who.alice, TEAM, { title: "  Café spec \n" });
    expect(page.title).toBe("Café spec");
    const row = await prisma.document.findUniqueOrThrow({ where: { id: page.id } });
    expect(row.title).toBe("Café spec");
  });

  it.each([
    ["empty", "   "],
    ["a control character", "a\tb"],
    ["too long", "x".repeat(256)],
  ])("refuses a title that is %s with VALIDATION at title", async (_label, title) => {
    const error = await expectError(createPage(who.alice, TEAM, { title }), ValidationError);
    expect(error.errors.map((e) => e.path)).toEqual(["title"]);
    expect(await prisma.document.count()).toBe(0);
  });

  it("refuses a title another live page has (case-insensitively) with TITLE_TAKEN, writing nothing", async () => {
    await createPageAs("alice", "team", { title: "Spec" });
    await expectError(createPage(who.alice, TEAM, { title: "SPEC" }), TitleTakenError);
    expect(await prisma.document.count()).toBe(1);
    expect(await auditRows()).toHaveLength(0);
  });

  it("maps the unique index to TITLE_TAKEN when two creates race for one title", async () => {
    const results = await Promise.allSettled([
      createPage(who.alice, TEAM, { title: "Race" }),
      createPage(who.bob, TEAM, { title: "race" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" ? failed.reason : null).toBeInstanceOf(TitleTakenError);
  });

  it("allows a title a deleted page had", async () => {
    const old = await createPageAs("alice", "team", { title: "Reuse" });
    await deletePage(who.alice, TEAM, old.id);
    expect((await createPage(who.alice, TEAM, { title: "Reuse" })).title).toBe("Reuse");
  });

  it("creates a child at the end of its parent's children, with ancestors", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Root", children: [{ title: "First" }] }]);
    const child = await createPage(who.alice, TEAM, { title: "Second", parentId: ids.Root });
    expect(child).toMatchObject({ parentId: ids.Root, ordinal: 1, ancestors: [{ id: ids.Root, title: "Root" }] });
  });

  it("refuses a parent that is not a live page of this space with VALIDATION at parentId", async () => {
    const other = await createPageAs("alice", "plat", { title: "Elsewhere" });
    const gone = await createPageAs("alice", "team", { title: "Gone" });
    await deletePage(who.alice, TEAM, gone.id);
    for (const parentId of [other.id, gone.id, "no-such-page", "bad id!"]) {
      const error = await expectError(createPage(who.alice, TEAM, { title: `Child of ${parentId}`, parentId }), ValidationError);
      expect(error.errors.map((e) => e.path)).toEqual(["parentId"]);
    }
    expect(await prisma.document.count({ where: { deletedAt: null } })).toBe(1);
  });

  it("needs EDIT: 403 for a viewer, 404 for a space the caller cannot see", async () => {
    await expectError(createPage(who.carol, TEAM), ForbiddenError);
    await expectError(createPage(who.bob, PLAT), ForbiddenError);
    await expectError(createPage(who.carol, PLAT), NotFoundError);
    expect(await prisma.document.count()).toBe(0);
  });
});

describe("movePage", () => {
  it("reorders within the parent and keeps ordinals dense", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A" }, { title: "B" }, { title: "C" }]);
    const moved = await movePage(who.bob, TEAM, ids.C as string, { parentId: null, index: 0 });
    expect(moved.ordinal).toBe(0);
    const tree = await listPageTree(who.bob, TEAM);
    expect(tree.pages.map((p) => [p.title, p.ordinal])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
  });

  it("reparents, clamping the index, renumbering both sibling lists, and audits from and to", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1" }] }, { title: "B" }, { title: "C" }]);
    const moved = await movePage(who.alice, TEAM, ids.B as string, { parentId: ids.A as string, index: 99 });
    expect(moved).toMatchObject({ parentId: ids.A, ordinal: 1, ancestors: [{ id: ids.A, title: "A" }] });
    const tree = await listPageTree(who.alice, TEAM);
    expect(tree.pages.map((p) => [p.title, p.parentId, p.ordinal])).toEqual([
      ["A", null, 0],
      ["C", null, 1],
      ["A1", ids.A, 0],
      ["B", ids.A, 1],
    ]);
    const audit = (await auditRows(ids.B)).find((r) => r.operation === "page.move");
    expect(audit?.parameters).toMatchObject({ from: { parentId: null, ordinal: 1 }, to: { parentId: ids.A, ordinal: 1 }, index: 99 });
  });

  it("refuses a move under the page itself or a descendant with CYCLE", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1", children: [{ title: "A11" }] }] }]);
    await expectError(movePage(who.alice, TEAM, ids.A as string, { parentId: ids.A as string, index: 0 }), CycleError);
    await expectError(movePage(who.alice, TEAM, ids.A as string, { parentId: ids.A11 as string, index: 0 }), CycleError);
    expect((await auditRows()).filter((r) => r.operation === "page.move")).toEqual([]);
  });

  it("refuses an unknown, deleted, malformed or other-space parent with VALIDATION at parentId", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A" }, { title: "Gone" }]);
    await deletePage(who.alice, TEAM, ids.Gone as string);
    const other = await createPageAs("alice", "plat", { title: "Elsewhere" });
    for (const parentId of ["no-such-page", ids.Gone as string, other.id, "bad id!"]) {
      const error = await expectError(movePage(who.alice, TEAM, ids.A as string, { parentId, index: 0 }), ValidationError);
      expect(error.errors.map((e) => e.path)).toEqual(["parentId"]);
    }
  });

  it("does nothing, and audits nothing, for a move to where the page already is", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A" }, { title: "B" }]);
    const page = await movePage(who.alice, TEAM, ids.B as string, { parentId: null, index: 1 });
    expect(page.ordinal).toBe(1);
    expect((await auditRows()).filter((r) => r.operation === "page.move")).toEqual([]);
  });

  it("is NotFound for a page of another space addressed through this one, and 403 for a viewer", async () => {
    const plat = await createPageAs("alice", "plat", { title: "P" });
    await expectError(movePage(who.alice, TEAM, plat.id, { parentId: null, index: 0 }), NotFoundError);
    const team = await createPageAs("alice", "team", { title: "T" });
    await expectError(movePage(who.carol, TEAM, team.id, { parentId: null, index: 0 }), ForbiddenError);
  });
});

describe("deletePage", () => {
  it("soft-deletes the subtree, reports and audits the count, and frees the titles", async () => {
    const ids = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1", children: [{ title: "A11" }] }, { title: "A2" }] }, { title: "B" }]);
    expect((await getPageView(who.bob, TEAM, ids.A as string)).page.descendantCount).toBe(3);
    expect(await deletePage(who.bob, TEAM, ids.A as string)).toEqual({ deletedCount: 4 });
    expect((await listPageTree(who.bob, TEAM)).pages.map((p) => [p.title, p.ordinal])).toEqual([["B", 0]]);
    await expectError(getPageView(who.bob, TEAM, ids.A1 as string), NotFoundError);
    const audit = (await auditRows(ids.A)).find((r) => r.operation === "page.delete");
    expect(audit).toMatchObject({ actorId: who.bob.id });
    expect(audit?.parameters).toMatchObject({ title: "A", parentId: null, deletedCount: 4 });
    expect((await createPage(who.bob, TEAM, { title: "A1" })).title).toBe("A1");
  });

  it("is NotFound for a page already deleted, and for another space's page", async () => {
    const page = await createPageAs("alice", "team", { title: "Once" });
    await deletePage(who.alice, TEAM, page.id);
    await expectError(deletePage(who.alice, TEAM, page.id), NotFoundError);
    const plat = await createPageAs("alice", "plat", { title: "P" });
    await expectError(deletePage(who.alice, TEAM, plat.id), NotFoundError);
    expect((await auditRows()).filter((r) => r.operation === "page.delete")).toHaveLength(1);
  });

  it("needs EDIT", async () => {
    const page = await createPageAs("alice", "team");
    await expectError(deletePage(who.carol, TEAM, page.id), ForbiddenError);
    expect(await prisma.document.count({ where: { deletedAt: null } })).toBe(1);
  });
});
