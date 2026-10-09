// versions.ts and the page lock: numbering, history reads, deletion refusals, and two
// publishes racing for the same page.
// spec: docs/specs/01-domain-model.md (DocumentVersion, invariant D2); RD-055, RD-056, RD-060; 08 §3.2
import { beforeEach, describe, expect, it } from "vitest";
import { CurrentVersionError, NotFoundError, PinnedVersionError, TitleTakenError, ValidationError } from "@/domain/errors";
import { getPage, softDeleteSubtree } from "@/server/repositories/documents";
import { clientOf } from "@/server/repositories/internal";
import { lockPage, rootDb, transaction, type Tx } from "@/server/repositories/transaction";
import { deleteVersion, getVersion, insertVersion, listVersions } from "@/server/repositories/versions";
import { createPageAs, demoIds, paragraphDoc, publishVersions, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

let ids: DemoIds;
beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

const numbers = async (documentId: string) =>
  (await prisma.documentVersion.findMany({ where: { documentId }, orderBy: { number: "asc" } })).map((v) => v.number);

describe("insertVersion", () => {
  it("numbers versions 1, 2, 3, … and makes each one current, carrying the title onto the page", async () => {
    const page = await createPageAs("alice", "team", { title: "Doc", versions: 3 });
    expect(page.versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(page.versions.every((v) => v.current)).toBe(true); // each was current when inserted
    const [renamed] = await publishVersions("bob", page.id, 1, { title: "Doc renamed" });
    expect(renamed).toMatchObject({ number: 4, title: "Doc renamed", author: { id: ids.users.bob, name: "Bob Editor" }, current: true, pinned: false });
    const row = await prisma.document.findUniqueOrThrow({ where: { id: page.id }, include: { currentVersion: true } });
    expect(row.title).toBe("Doc renamed");
    expect(row.currentVersion?.number).toBe(4);
  });

  it("never reuses a number: deleting a middle version leaves a gap that stays", async () => {
    const page = await createPageAs("alice", "team", { versions: 3 });
    await deleteVersion(rootDb, page.id, 2);
    await publishVersions("alice", page.id, 1);
    expect(await numbers(page.id)).toEqual([1, 3, 4]);
  });

  it("stores the content, title and change note exactly as given", async () => {
    const page = await createPageAs("alice", "team", { title: "Exact" });
    const content = { type: "doc", content: [{ type: "heading", attrs: { level: 2, textAlign: null, indent: 0 }, content: [{ type: "text", text: "Ünïcödé ✓" }] }] };
    const v = await transaction((tx) =>
      insertVersion(tx, { documentId: page.id, title: "Exact", content, authorId: ids.users.bob, message: "what changed" }),
    );
    const got = await getVersion(rootDb, ids.users.carol, page.id, v.number);
    expect(got).toMatchObject({ number: 2, title: "Exact", message: "what changed", current: true, author: { id: ids.users.bob } });
    expect(got?.content).toEqual(content);
  });

  it("refuses a deleted page, a taken title (rolling the whole publish back), and missing content", async () => {
    const a = await createPageAs("alice", "team", { title: "Taken" });
    const b = await createPageAs("alice", "team", { title: "Other" });
    const publish = (documentId: string, title: string, content: unknown = paragraphDoc("x")) =>
      transaction((tx) => insertVersion(tx, { documentId, title, content, authorId: ids.users.alice }));
    await expect(publish(b.id, "TAKEN")).rejects.toBeInstanceOf(TitleTakenError);
    expect(await numbers(b.id)).toEqual([1]); // the version insert rolled back with the rename
    await expect(publish(b.id, "Other", null)).rejects.toBeInstanceOf(ValidationError);
    await expect(publish(b.id, " ")).rejects.toBeInstanceOf(ValidationError);
    await transaction((tx) => softDeleteSubtree(tx, { documentId: a.id, deletedById: ids.users.alice }));
    await expect(publish(a.id, "Taken")).rejects.toBeInstanceOf(NotFoundError);
    await expect(publish("no-such-page", "X")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listVersions and getVersion", () => {
  it("lists newest first with current and pinned flags", async () => {
    const page = await createPageAs("alice", "team", { versions: 3 });
    await prisma.documentVersion.update({ where: { id: page.versions[0]!.id }, data: { pinned: true } });
    const list = await listVersions(rootDb, ids.users.carol, page.id);
    expect(list?.map((v) => [v.number, v.current, v.pinned])).toEqual([
      [3, true, false],
      [2, false, false],
      [1, false, true],
    ]);
    expect(list?.[0]?.author).toEqual({ id: ids.users.alice, name: "Alice Admin" });
  });

  it("getVersion is null for an unknown or nonsensical number", async () => {
    const page = await createPageAs("alice", "team");
    for (const n of [0, -1, 2, 1.5, Number.NaN, 2 ** 31]) expect(await getVersion(rootDb, ids.users.alice, page.id, n)).toBeNull();
    expect((await getVersion(rootDb, ids.users.alice, page.id, 1))?.current).toBe(true);
  });
});

describe("deleteVersion", () => {
  it("deletes a non-current, non-pinned version", async () => {
    const page = await createPageAs("alice", "team", { versions: 3 });
    await deleteVersion(rootDb, page.id, 1);
    expect(await numbers(page.id)).toEqual([2, 3]);
  });

  it("refuses the current version with CurrentVersionError", async () => {
    const page = await createPageAs("alice", "team", { versions: 2 });
    await expect(deleteVersion(rootDb, page.id, 2)).rejects.toBeInstanceOf(CurrentVersionError);
    expect(await numbers(page.id)).toEqual([1, 2]);
  });

  it("refuses a pinned version with PinnedVersionError", async () => {
    const page = await createPageAs("alice", "team", { versions: 2 });
    await prisma.documentVersion.update({ where: { id: page.versions[0]!.id }, data: { pinned: true } });
    await expect(deleteVersion(rootDb, page.id, 1)).rejects.toBeInstanceOf(PinnedVersionError);
    expect(await numbers(page.id)).toEqual([1, 2]);
  });

  it("answers NotFoundError for a version the page does not have", async () => {
    const page = await createPageAs("alice", "team");
    await expect(deleteVersion(rootDb, page.id, 7)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteVersion(rootDb, page.id, 0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteVersion(rootDb, "nope", 1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("lockPage", () => {
  it("returns the page's state, or null for an unknown page", async () => {
    const page = await createPageAs("alice", "team", { title: "Locked", versions: 2 });
    expect(await transaction((tx) => lockPage(tx, page.id))).toEqual({
      id: page.id,
      spaceId: ids.spaces.team,
      title: "Locked",
      deleted: false,
      currentVersion: 2,
    });
    expect(await transaction((tx) => lockPage(tx, "nope"))).toBeNull();
  });

  it("serialises two publishes that each lock, read MAX and insert: numbers 2 and 3, no duplicate, no violation", async () => {
    const page = await createPageAs("alice", "team", { title: "Race" });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // A publish written out by hand, with a pause between reading MAX and inserting — the
    // window in which, without the lock, both would read 1 and both would insert 2.
    const publish = (authorId: string, startDelay: number) =>
      transaction(async (tx: Tx) => {
        await sleep(startDelay);
        const locked = await lockPage(tx, page.id);
        const client = clientOf(tx);
        const [row] = await client.$queryRaw<{ max: number }[]>`
          SELECT MAX("number")::int AS "max" FROM "DocumentVersion" WHERE "documentId" = ${page.id}`;
        const next = (row?.max ?? 0) + 1;
        await sleep(300);
        await client.documentVersion.create({
          data: { documentId: page.id, number: next, title: "Race", content: paragraphDoc(String(next)), authorId },
        });
        return { next, sawCurrent: locked?.currentVersion ?? null };
      });
    const results = await Promise.all([publish(ids.users.alice, 0), publish(ids.users.bob, 50)]);
    expect(results.map((r) => r.next).sort()).toEqual([2, 3]);
    // The second publish waited for the first and then saw a consistent page row.
    expect(results.every((r) => r.sawCurrent === 1)).toBe(true);
    expect(await numbers(page.id)).toEqual([1, 2, 3]);
  });

  it("two concurrent insertVersion calls both succeed, as 2 and 3", async () => {
    const page = await createPageAs("alice", "team", { title: "Race 2" });
    const publish = (authorId: string) =>
      transaction((tx) => insertVersion(tx, { documentId: page.id, title: "Race 2", content: paragraphDoc(authorId), authorId }));
    const [x, y] = await Promise.all([publish(ids.users.alice), publish(ids.users.bob)]);
    expect([x!.number, y!.number].sort()).toEqual([2, 3]);
    expect((await getPage(rootDb, ids.users.alice, page.id))?.currentVersion).toBe(3);
  });
});
