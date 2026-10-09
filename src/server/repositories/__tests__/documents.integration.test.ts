// documents.ts: the page tree, creation, titles, moves and soft deletion.
// spec: docs/specs/09-decision-log.md RD-056; docs/specs/08-api-surface.md section 3
import { beforeEach, describe, expect, it } from "vitest";
import { CycleError, NotFoundError, TitleTakenError, ValidationError } from "@/domain/errors";
import {
  applyOrdinals,
  countLiveDescendants,
  createPage,
  getPage,
  listPages,
  listTitlesInSpace,
  setTitle,
  softDeleteSubtree,
  type OrdinalChange,
} from "@/server/repositories/documents";
import { upsertDraft } from "@/server/repositories/drafts";
import { setFavourite, setWatching } from "@/server/repositories/social";
import { lockTree, rootDb, transaction } from "@/server/repositories/transaction";
import { buildTree, createPageAs, demoIds, paragraphDoc, publishVersions, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

let ids: DemoIds;
beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

const tree = async (viewer = ids.users.alice, spaceId = ids.spaces.team) =>
  (await listPages(rootDb, viewer, spaceId)).map((p) => ({ id: p.id, parentId: p.parentId, ordinal: p.ordinal }));

/** The space's live tree as "title@ordinal" per parent title, for readable assertions. */
async function shape(spaceId = ids.spaces.team): Promise<Record<string, string[]>> {
  const pages = await listPages(rootDb, ids.users.alice, spaceId);
  const title = new Map(pages.map((p) => [p.id, p.title]));
  const out: Record<string, string[]> = {};
  for (const p of pages) {
    const key = p.parentId === null ? "(root)" : (title.get(p.parentId) ?? "?");
    (out[key] ??= []).push(`${p.title}@${p.ordinal}`);
  }
  return out;
}

const move = (changes: readonly OrdinalChange[], spaceId = ids.spaces.team) =>
  transaction((tx) => applyOrdinals(tx, spaceId, changes));

describe("createPage", () => {
  it("appends each new page at the end of its sibling list", async () => {
    const t = await buildTree("alice", "team", [
      { title: "A", children: [{ title: "A1" }, { title: "A2" }] },
      { title: "B" },
      { title: "C" },
    ]);
    expect(await shape()).toEqual({ "(root)": ["A@0", "B@1", "C@2"], A: ["A1@0", "A2@1"] });
    expect(Object.keys(t)).toHaveLength(5);
  });

  it("creates the row without a version; the page appears only once its first version is in", async () => {
    await transaction(async (tx) => {
      const { id, ordinal } = await createPage(tx, { spaceId: ids.spaces.team, parentId: null, title: "Bare", createdById: ids.users.alice });
      expect(ordinal).toBe(0);
      const row = await prisma.document.findUnique({ where: { id } });
      expect(row).toBeNull(); // not visible outside the transaction yet
    });
    // Committed with no version: listPages and getPage only show pages with a current version.
    expect(await tree()).toEqual([]);
  });

  it("refuses a parent that is deleted, in another space, or unknown — and an unknown space", async () => {
    const team = await createPageAs("alice", "team", { title: "Parent" });
    const plat = await createPageAs("alice", "plat", { title: "Elsewhere" });
    const attempt = (spaceId: string, parentId: string | null) =>
      transaction((tx) => createPage(tx, { spaceId, parentId, title: "Child", createdById: ids.users.alice }));
    await expect(attempt(ids.spaces.team, plat.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt(ids.spaces.team, "no-such-page")).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt("no-such-space", null)).rejects.toBeInstanceOf(NotFoundError);
    await transaction((tx) => softDeleteSubtree(tx, { documentId: team.id, deletedById: ids.users.alice }));
    await expect(attempt(ids.spaces.team, team.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps a taken title (any case) to TitleTakenError and a blank one to ValidationError", async () => {
    await createPageAs("alice", "team", { title: "Spec" });
    const attempt = (title: string) =>
      transaction((tx) => createPage(tx, { spaceId: ids.spaces.team, parentId: null, title, createdById: ids.users.alice }));
    await expect(attempt("SPEC")).rejects.toBeInstanceOf(TitleTakenError);
    const blank = await attempt("  ").catch((e: unknown) => e);
    expect(blank).toBeInstanceOf(ValidationError);
    expect((blank as ValidationError).errors).toEqual([{ path: "title", message: expect.any(String) }]);
  });

  it("concurrent creates in one space get distinct ordinals (the tree lock serialises them)", async () => {
    const make = (title: string) =>
      transaction(async (tx) => {
        const created = await createPage(tx, { spaceId: ids.spaces.team, parentId: null, title, createdById: ids.users.alice });
        await new Promise((r) => setTimeout(r, 100));
        return created.ordinal;
      });
    const ordinals = await Promise.all([make("One"), make("Two"), make("Three")]);
    expect([...ordinals].sort()).toEqual([0, 1, 2]);
  });
});

describe("listPages and getPage", () => {
  it("lists the live tree ordered by parent, then ordinal", async () => {
    const t = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1" }] }, { title: "B" }]);
    const rows = await listPages(rootDb, ids.users.carol, ids.spaces.team);
    expect(rows.map((r) => r.title)).toEqual(["A", "B", "A1"]);
    expect(rows[2]).toMatchObject({ id: t.A1, parentId: t.A, ordinal: 0, currentVersion: 1 });
    expect(rows[0]!.lastModifiedAt).toBeInstanceOf(Date);
  });

  it("returns the page with its version, people, counts, ancestors and the viewer's own state", async () => {
    const t = await buildTree("alice", "team", [
      { title: "Root", children: [{ title: "Mid", children: [{ title: "Leaf", children: [{ title: "L1" }, { title: "L2" }] }] }] },
    ]);
    const [v2] = await publishVersions("bob", t.Leaf!, 1);
    await setWatching(rootDb, t.Leaf!, ids.users.carol, true);
    await upsertDraft(rootDb, { documentId: t.Leaf!, userId: ids.users.carol, title: "Leaf", content: paragraphDoc(), baseVersionNumber: 2 });

    const asCarol = await getPage(rootDb, ids.users.carol, t.Leaf!);
    expect(asCarol).toMatchObject({
      id: t.Leaf,
      spaceId: ids.spaces.team,
      spaceKey: "TEAM",
      title: "Leaf",
      parentId: t.Mid,
      ordinal: 0,
      currentVersion: 2,
      currentVersionId: v2!.id,
      createdBy: { id: ids.users.alice, name: "Alice Admin" },
      lastModifiedBy: { id: ids.users.bob, name: "Bob Editor" },
      descendantCount: 2,
      ancestors: [
        { id: t.Root, title: "Root" },
        { id: t.Mid, title: "Mid" },
      ],
      watching: true,
      favourite: false,
      hasDraft: true,
    });
    expect(asCarol!.lastModifiedAt.toISOString()).toBe(v2!.createdAt.toISOString());

    await setFavourite(rootDb, t.Leaf!, ids.users.bob, true);
    expect(await getPage(rootDb, ids.users.bob, t.Leaf!)).toMatchObject({ watching: false, favourite: true, hasDraft: false });
    expect((await getPage(rootDb, ids.users.alice, t.Root!))?.ancestors).toEqual([]);
  });

  it("descendantCount counts live pages only, and agrees with countLiveDescendants", async () => {
    const t = await buildTree("alice", "team", [
      { title: "Top", children: [{ title: "K1", children: [{ title: "K11" }] }, { title: "K2" }] },
    ]);
    expect(await countLiveDescendants(rootDb, ids.users.alice, t.Top!)).toBe(3);
    await transaction((tx) => softDeleteSubtree(tx, { documentId: t.K1!, deletedById: ids.users.alice }));
    expect(await countLiveDescendants(rootDb, ids.users.alice, t.Top!)).toBe(1);
    expect((await getPage(rootDb, ids.users.alice, t.Top!))?.descendantCount).toBe(1);
    expect(await countLiveDescendants(rootDb, ids.users.alice, t.K1!)).toBeNull();
  });

  it("listTitlesInSpace lists live titles only", async () => {
    const a = await createPageAs("alice", "team", { title: "Kept" });
    const b = await createPageAs("alice", "team", { title: "Dropped" });
    await transaction((tx) => softDeleteSubtree(tx, { documentId: b.id, deletedById: ids.users.alice }));
    expect(await listTitlesInSpace(rootDb, ids.users.alice, ids.spaces.team)).toEqual(["Kept"]);
    expect(a.title).toBe("Kept");
  });
});

describe("setTitle", () => {
  it("renames a live page, refuses a taken title, and does not find a deleted page", async () => {
    const a = await createPageAs("alice", "team", { title: "First" });
    const b = await createPageAs("alice", "team", { title: "Second" });
    await setTitle(rootDb, a.id, "Renamed");
    expect((await getPage(rootDb, ids.users.alice, a.id))?.title).toBe("Renamed");
    await expect(setTitle(rootDb, b.id, "renamed")).rejects.toBeInstanceOf(TitleTakenError);
    await transaction((tx) => softDeleteSubtree(tx, { documentId: b.id, deletedById: ids.users.alice }));
    await expect(setTitle(rootDb, b.id, "Other")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("applyOrdinals — the changes of planMove", () => {
  it("reorders within one parent", async () => {
    const t = await buildTree("alice", "team", [{ title: "A" }, { title: "B" }, { title: "C" }]);
    // planMove(C to index 0): C@0, A@1, B@2
    await move([
      { id: t.C!, parentId: null, ordinal: 0 },
      { id: t.A!, parentId: null, ordinal: 1 },
      { id: t.B!, parentId: null, ordinal: 2 },
    ]);
    expect(await shape()).toEqual({ "(root)": ["C@0", "A@1", "B@2"] });
  });

  it("reparents and renumbers both sibling lists", async () => {
    const t = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1" }] }, { title: "B" }, { title: "C" }]);
    // planMove(B under A at index 0): B@0 A1@1 under A; C@1 at the root
    await move([
      { id: t.B!, parentId: t.A!, ordinal: 0 },
      { id: t.A1!, parentId: t.A!, ordinal: 1 },
      { id: t.C!, parentId: null, ordinal: 1 },
    ]);
    expect(await shape()).toEqual({ "(root)": ["A@0", "C@1"], A: ["B@0", "A1@1"] });
  });

  it("applies several reparents in an order that never passes through a cycle", async () => {
    // A > B  becomes  B > A. Applied in list order, "A under B" while B is still under A is a cycle.
    const t = await buildTree("alice", "team", [{ title: "A", children: [{ title: "B" }] }]);
    await move([
      { id: t.A!, parentId: t.B!, ordinal: 0 },
      { id: t.B!, parentId: null, ordinal: 0 },
    ]);
    expect(await shape()).toEqual({ "(root)": ["B@0"], B: ["A@0"] });
  });

  it("maps a move under a descendant to CycleError and changes nothing", async () => {
    const t = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1", children: [{ title: "A11" }] }] }]);
    const before = await tree();
    await expect(move([{ id: t.A!, parentId: t.A11!, ordinal: 0 }])).rejects.toBeInstanceOf(CycleError);
    await expect(move([{ id: t.A!, parentId: t.A!, ordinal: 0 }])).rejects.toBeInstanceOf(CycleError);
    expect(await tree()).toEqual(before);
  });

  it("refuses unknown, deleted or other-space pages and parents with NotFoundError", async () => {
    const t = await buildTree("alice", "team", [{ title: "A" }, { title: "B" }]);
    const plat = await createPageAs("alice", "plat", { title: "P" });
    await expect(move([{ id: plat.id, parentId: null, ordinal: 0 }])).rejects.toBeInstanceOf(NotFoundError);
    await expect(move([{ id: t.A!, parentId: plat.id, ordinal: 0 }])).rejects.toBeInstanceOf(NotFoundError);
    await expect(move([{ id: "nope", parentId: null, ordinal: 0 }])).rejects.toBeInstanceOf(NotFoundError);
    await transaction((tx) => softDeleteSubtree(tx, { documentId: t.B!, deletedById: ids.users.alice }));
    await expect(move([{ id: t.A!, parentId: t.B!, ordinal: 0 }])).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an empty plan is a no-op", async () => {
    await move([]);
  });
});

describe("softDeleteSubtree", () => {
  it("deletes the page and every live descendant with one deletedAt and deletedRootId, and counts them", async () => {
    const t = await buildTree("alice", "team", [
      { title: "A", children: [{ title: "A1", children: [{ title: "A11" }] }, { title: "A2" }] },
      { title: "B" },
      { title: "C" },
    ]);
    const at = new Date("2026-10-09T09:30:00.000Z");
    const count = await transaction((tx) => softDeleteSubtree(tx, { documentId: t.A!, deletedById: ids.users.bob, at }));
    expect(count).toBe(4);
    const rows = await prisma.document.findMany({ where: { id: { in: [t.A!, t.A1!, t.A11!, t.A2!] } } });
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.deletedAt?.toISOString()).toBe(at.toISOString());
      expect(r.deletedRootId).toBe(t.A);
      expect(r.deletedById).toBe(ids.users.bob);
    }
    // The survivors are renumbered densely.
    expect(await shape()).toEqual({ "(root)": ["B@0", "C@1"] });
  });

  it("leaves pages deleted earlier with their own deletion, and refuses a second delete", async () => {
    const t = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1" }, { title: "A2" }] }]);
    const first = new Date("2026-10-01T00:00:00.000Z");
    expect(await transaction((tx) => softDeleteSubtree(tx, { documentId: t.A1!, deletedById: ids.users.alice, at: first }))).toBe(1);
    expect(await transaction((tx) => softDeleteSubtree(tx, { documentId: t.A!, deletedById: ids.users.alice }))).toBe(2);
    const a1 = await prisma.document.findUniqueOrThrow({ where: { id: t.A1! } });
    expect(a1.deletedRootId).toBe(t.A1);
    expect(a1.deletedAt?.toISOString()).toBe(first.toISOString());
    await expect(transaction((tx) => softDeleteSubtree(tx, { documentId: t.A!, deletedById: ids.users.alice }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("frees the deleted titles for reuse", async () => {
    const t = await buildTree("alice", "team", [{ title: "Reuse", children: [{ title: "Reuse child" }] }]);
    await transaction((tx) => softDeleteSubtree(tx, { documentId: t.Reuse!, deletedById: ids.users.alice }));
    await createPageAs("alice", "team", { title: "reuse" });
    await createPageAs("alice", "team", { title: "Reuse child" });
  });
});

describe("lockTree", () => {
  it("is false for an unknown space", async () => {
    expect(await transaction((tx) => lockTree(tx, "no-such-space"))).toBe(false);
    expect(await transaction((tx) => lockTree(tx, ids.spaces.team))).toBe(true);
  });
});
