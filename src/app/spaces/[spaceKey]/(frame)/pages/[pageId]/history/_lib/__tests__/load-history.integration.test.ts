// Page History and Compare against a real database, through the real use cases: what the routes
// render from, the rows the view model builds from it, and every way they become the 404 page
// (RD-051: a viewer without access never learns the page exists).
//
//            TEAM                        PLAT
//  alice   VIEW EDIT EXPORT ADMIN      VIEW EDIT EXPORT ADMIN
//  bob     VIEW EDIT EXPORT            VIEW
//  carol   VIEW                        — (cannot see the space at all)
// spec: docs/specs/10-ui-reference.md sections 11 and 23; docs/specs/09-decision-log.md sections RD-051, RD-060
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { deletePage, deleteVersion, restoreVersion } from "@/server/usecases/pages";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { actorFor, prisma, resetDemoInstance } from "@/test-support/fixtures";
import { buildCompareModel } from "../compare-model";
import { buildHistoryModel } from "../history-model";
import { loadComparison, loadHistory } from "../load-history";

let alice: Actor;
let bob: Actor;
let carol: Actor;

beforeEach(async () => {
  await resetDemoInstance();
  [alice, bob, carol] = await Promise.all([actorFor("alice"), actorFor("bob"), actorFor("carol")]);
});

async function notFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(NotFoundError);
}

/** A page with v1, v2 published and v3 = "Restored from v. 1" made by the restore use case. */
async function restoredPage() {
  const created = await createPageAs("alice", "team", {
    title: "Specifications",
    versions: 2,
    content: (n) => paragraphDoc(`Scope v${n}`, "Shared paragraph"),
  });
  const restored = await restoreVersion(bob, "TEAM", created.id, 1);
  return { id: created.id, restored };
}

describe("loadHistory", () => {
  it("lists three versions, the restore on top as CURRENT, with comments and authors", async () => {
    const { id, restored } = await restoredPage();
    expect(restored.version.number).toBe(3);

    const screen = await loadHistory(alice, "team", id);
    expect(screen.space).toEqual({ key: "TEAM", name: "Team" });
    const model = buildHistoryModel(screen);

    expect(model.rows.map((r) => r.label)).toEqual(["CURRENT (v. 3)", "v. 2", "v. 1"]);
    expect(model.rows.map((r) => r.comment)).toEqual(["Restored from v. 1", "edit 2", ""]);
    expect(model.rows.map((r) => r.author)).toEqual(["Bob Editor", "Alice Admin", "Alice Admin"]);
    expect(model.rows[1]?.href).toBe(`/spaces/TEAM/pages/${encodeURIComponent(id)}?version=2`);
    expect(model.initialSelected).toEqual([3]);
    expect(model.crumbs.map((c) => c.label)).toEqual(["Pages", "Specifications"]);
    expect(model.rows.every((r) => /^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}$/.test(r.published))).toBe(true);
  });

  it("offers each viewer the actions their space permissions allow", async () => {
    const { id } = await restoredPage();
    const actionsOf = async (actor: Actor) =>
      buildHistoryModel(await loadHistory(actor, "TEAM", id)).rows.map((r) => [r.number, r.restore, r.delete.kind]);

    expect(await actionsOf(alice)).toEqual([
      [3, false, "hidden"],
      [2, true, "enabled"],
      [1, true, "enabled"],
    ]);
    expect(await actionsOf(bob)).toEqual([
      [3, false, "hidden"],
      [2, true, "hidden"],
      [1, true, "hidden"],
    ]);
    expect(await actionsOf(carol)).toEqual([
      [3, false, "hidden"],
      [2, false, "hidden"],
      [1, false, "hidden"],
    ]);
  });

  it("disables Delete on a version pinned by a baseline", async () => {
    const { id } = await restoredPage();
    await prisma.documentVersion.updateMany({ where: { documentId: id, number: 1 }, data: { pinned: true } });
    const rows = buildHistoryModel(await loadHistory(alice, "TEAM", id)).rows;
    expect(rows.find((r) => r.number === 1)?.delete).toEqual({ kind: "disabled", reason: "Pinned by a baseline" });
    expect(rows.find((r) => r.number === 2)?.delete).toEqual({ kind: "enabled" });
  });

  it("no longer lists a version deleted through the use case", async () => {
    const { id } = await restoredPage();
    await deleteVersion(alice, "TEAM", id, 2);
    expect(buildHistoryModel(await loadHistory(alice, "TEAM", id)).versions).toEqual([3, 1]);
  });

  it("is not found for a space the viewer cannot see, an unknown or deleted page, or the wrong space", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Platform page" });
    await notFound(loadHistory(carol, "PLAT", plat.id));
    await notFound(loadHistory(alice, "TEAM", plat.id));
    await notFound(loadHistory(alice, "TEAM", "no-such-page"));
    await notFound(loadHistory(alice, "NOPE", plat.id));
    const team = await createPageAs("alice", "team", { title: "Doomed" });
    await deletePage(alice, "TEAM", team.id);
    await notFound(loadHistory(alice, "TEAM", team.id));
  });
});

describe("loadComparison", () => {
  it("compares two versions side by side, the first on the left", async () => {
    const { id } = await restoredPage();
    const input = await loadComparison(carol, "team", id, { a: 1, b: 2 });
    expect(input.space).toEqual({ key: "TEAM" });
    expect(input.left).toMatchObject({ number: 1, current: false, message: null });
    expect(input.right).toMatchObject({ number: 2, current: false, message: "edit 2" });
    expect(input.approximate).toBe(false);

    const model = buildCompareModel(input);
    expect(model.rows.map((r) => r.status)).toEqual(["changed", "same"]);
    expect(model.counts).toEqual({ added: 0, removed: 0, changed: 1, same: 1 });
    expect(model.identical).toBe(false);
    expect(model.left.label).toBe("v. 1");
  });

  it("finds a restored version identical to the one it was restored from", async () => {
    const { id } = await restoredPage();
    const model = buildCompareModel(await loadComparison(alice, "TEAM", id, { a: 1, b: 3 }));
    expect(model.identical).toBe(true);
    expect(model.titleChanged).toBe(false);
    expect(model.right).toMatchObject({ label: "CURRENT (v. 3)", comment: "Restored from v. 1", author: "Bob Editor" });
  });

  it("keeps the order it is given", async () => {
    const { id } = await restoredPage();
    const input = await loadComparison(alice, "TEAM", id, { a: 2, b: 1 });
    expect([input.left.number, input.right.number]).toEqual([2, 1]);
  });

  it("is not found for a version that does not exist or a viewer who cannot see the space", async () => {
    const { id } = await restoredPage();
    await notFound(loadComparison(alice, "TEAM", id, { a: 1, b: 99 }));
    await deleteVersion(alice, "TEAM", id, 2);
    await notFound(loadComparison(alice, "TEAM", id, { a: 1, b: 2 }));
    const plat = await createPageAs("alice", "plat", { title: "Platform page", versions: 2 });
    await notFound(loadComparison(carol, "PLAT", plat.id, { a: 1, b: 2 }));
    expect((await loadComparison(bob, "PLAT", plat.id, { a: 1, b: 2 })).left.number).toBe(1);
  });
});
