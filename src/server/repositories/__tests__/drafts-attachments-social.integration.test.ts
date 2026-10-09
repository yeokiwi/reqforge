// drafts.ts, attachments.ts, social.ts and audit.ts.
// spec: RD-055 (drafts), RD-058 (attachments), RD-061 (watch, save for later), RD-062 (presence), 07 §6 (audit)
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, TooLargeError, ValidationError } from "@/domain/errors";
import {
  ATTACHMENT_MAX_BYTES,
  allAttachmentIdsForPage,
  getAttachmentForRead,
  insertAttachment,
  listAttachments,
  softDeleteAttachment,
} from "@/server/repositories/attachments";
import { writeAudit } from "@/server/repositories/audit";
import { deleteDraft, getDraft, upsertDraft } from "@/server/repositories/drafts";
import {
  isFavourite,
  isWatching,
  listPresence,
  prunePresence,
  setFavourite,
  setWatching,
  touchPresence,
} from "@/server/repositories/social";
import { rootDb, transaction } from "@/server/repositories/transaction";
import { createPageAs, demoIds, paragraphDoc, publishVersions, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

let ids: DemoIds;
beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

describe("drafts (RD-055)", () => {
  it("upsert creates, then replaces, the one draft per (page, user)", async () => {
    const page = await createPageAs("alice", "team", { title: "Draft me" });
    const t1 = new Date("2026-10-09T10:00:00.000Z");
    const t2 = new Date("2026-10-09T10:00:05.000Z");
    await upsertDraft(rootDb, { documentId: page.id, userId: ids.users.bob, title: "Draft me", content: paragraphDoc("one"), baseVersionNumber: 1, at: t1 });
    const saved = await upsertDraft(rootDb, { documentId: page.id, userId: ids.users.bob, title: "Draft me!", content: paragraphDoc("two"), baseVersionNumber: 1, at: t2 });
    expect(saved.updatedAt.toISOString()).toBe(t2.toISOString());
    expect(await prisma.documentDraft.count({ where: { documentId: page.id } })).toBe(1);
    expect(await getDraft(rootDb, ids.users.bob, page.id)).toEqual({
      documentId: page.id,
      userId: ids.users.bob,
      title: "Draft me!",
      content: paragraphDoc("two"),
      baseVersionNumber: 1,
      updatedAt: t2,
      currentVersion: 1,
    });
    // Drafts are per user: alice has none.
    expect(await getDraft(rootDb, ids.users.alice, page.id)).toBeNull();
  });

  it("reports the current version so the caller can tell a stale draft", async () => {
    const page = await createPageAs("alice", "team");
    await upsertDraft(rootDb, { documentId: page.id, userId: ids.users.bob, title: "t", content: paragraphDoc(), baseVersionNumber: 1 });
    await publishVersions("alice", page.id, 2);
    expect(await getDraft(rootDb, ids.users.bob, page.id)).toMatchObject({ baseVersionNumber: 1, currentVersion: 3 });
  });

  it("delete is idempotent", async () => {
    const page = await createPageAs("alice", "team");
    await upsertDraft(rootDb, { documentId: page.id, userId: ids.users.bob, title: "t", content: paragraphDoc(), baseVersionNumber: 1 });
    expect(await deleteDraft(rootDb, page.id, ids.users.bob)).toBe(true);
    expect(await deleteDraft(rootDb, page.id, ids.users.bob)).toBe(false);
    expect(await deleteDraft(rootDb, "no-such-page", ids.users.bob)).toBe(false);
    expect(await getDraft(rootDb, ids.users.bob, page.id)).toBeNull();
  });

  it("maps refusals: unknown page → NotFoundError, bad title or base → ValidationError, no content → ValidationError", async () => {
    const page = await createPageAs("alice", "team");
    const save = (over: Partial<Parameters<typeof upsertDraft>[1]>) =>
      upsertDraft(rootDb, { documentId: page.id, userId: ids.users.bob, title: "t", content: paragraphDoc(), baseVersionNumber: 1, ...over });
    await expect(save({ documentId: "no-such-page" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(save({ title: "x".repeat(256) })).rejects.toBeInstanceOf(ValidationError);
    await expect(save({ baseVersionNumber: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(save({ content: null })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("attachments (RD-058)", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const upload = (documentId: string, data: Uint8Array, filename = "f.png", at?: Date) =>
    insertAttachment(rootDb, { documentId, filename, contentType: "image/png", data, uploadedById: ids.users.bob, ...(at ? { at } : {}) });

  it("computes size and SHA-256 from the bytes and serves the same bytes back", async () => {
    const page = await createPageAs("alice", "team");
    const data = bytes(137, 80, 78, 71, 0, 255);
    const att = await upload(page.id, data);
    expect(att).toMatchObject({
      documentId: page.id,
      filename: "f.png",
      contentType: "image/png",
      size: 6,
      sha256: createHash("sha256").update(data).digest("hex"),
      uploadedBy: { id: ids.users.bob, name: "Bob Editor" },
      deletedAt: null,
    });
    const read = await getAttachmentForRead(rootDb, ids.users.carol, att.id);
    expect(read?.data).toBeInstanceOf(Uint8Array);
    expect([...(read?.data ?? [])]).toEqual([...data]);
    expect(read?.spaceId).toBe(ids.spaces.team);
  });

  it("lists live attachments newest first; a hidden one leaves the list but is still served and still counts for image nodes", async () => {
    const page = await createPageAs("alice", "team");
    const old = await upload(page.id, bytes(1), "old.png", new Date("2026-10-01T00:00:00Z"));
    const mid = await upload(page.id, bytes(2), "mid.png", new Date("2026-10-02T00:00:00Z"));
    const neu = await upload(page.id, bytes(3), "new.png", new Date("2026-10-03T00:00:00Z"));
    expect((await listAttachments(rootDb, ids.users.carol, page.id))?.map((a) => a.filename)).toEqual(["new.png", "mid.png", "old.png"]);

    expect(await softDeleteAttachment(rootDb, page.id, mid.id)).toBe("hidden");
    expect((await listAttachments(rootDb, ids.users.carol, page.id))?.map((a) => a.id)).toEqual([neu.id, old.id]);
    const hidden = await getAttachmentForRead(rootDb, ids.users.carol, mid.id);
    expect(hidden?.deletedAt).toBeInstanceOf(Date);
    expect([...(hidden?.data ?? [])]).toEqual([2]);
    expect([...(await allAttachmentIdsForPage(rootDb, ids.users.alice, page.id))].sort()).toEqual([old.id, mid.id, neu.id].sort());
  });

  it("hiding is idempotent, keeps the first deletedAt, and only applies on the attachment's own page", async () => {
    const page = await createPageAs("alice", "team");
    const other = await createPageAs("alice", "team");
    const att = await upload(page.id, bytes(9));
    const first = new Date("2026-10-09T08:00:00.000Z");
    expect(await softDeleteAttachment(rootDb, other.id, att.id)).toBe("not_found");
    expect(await softDeleteAttachment(rootDb, page.id, att.id, first)).toBe("hidden");
    expect(await softDeleteAttachment(rootDb, page.id, att.id, new Date())).toBe("already_hidden");
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } })).deletedAt?.toISOString()).toBe(first.toISOString());
    expect(await softDeleteAttachment(rootDb, page.id, "nope")).toBe("not_found");
  });

  it("maps an oversize upload to TooLargeError with the limit, and an empty one to ValidationError", async () => {
    const page = await createPageAs("alice", "team");
    const big = await upload(page.id, new Uint8Array(ATTACHMENT_MAX_BYTES + 1)).catch((e: unknown) => e);
    expect(big).toBeInstanceOf(TooLargeError);
    expect((big as TooLargeError).limit).toBe(10_485_760);
    await expect(upload(page.id, new Uint8Array(0))).rejects.toBeInstanceOf(ValidationError);
    await expect(upload("no-such-page", bytes(1))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not serve an attachment of a deleted page", async () => {
    const page = await createPageAs("alice", "team");
    const att = await upload(page.id, bytes(1));
    await prisma.document.update({ where: { id: page.id }, data: { deletedAt: new Date(), deletedRootId: page.id } });
    expect(await getAttachmentForRead(rootDb, ids.users.alice, att.id)).toBeNull();
    expect(await listAttachments(rootDb, ids.users.alice, page.id)).toBeNull();
  });
});

describe("Watching and Save for later (RD-061)", () => {
  it("are idempotent toggles, per user", async () => {
    const page = await createPageAs("alice", "team");
    await setWatching(rootDb, page.id, ids.users.bob, true);
    await setWatching(rootDb, page.id, ids.users.bob, true);
    expect(await isWatching(rootDb, page.id, ids.users.bob)).toBe(true);
    expect(await isWatching(rootDb, page.id, ids.users.carol)).toBe(false);
    await setWatching(rootDb, page.id, ids.users.bob, false);
    await setWatching(rootDb, page.id, ids.users.bob, false);
    expect(await isWatching(rootDb, page.id, ids.users.bob)).toBe(false);

    await setFavourite(rootDb, page.id, ids.users.carol, true);
    await setFavourite(rootDb, page.id, ids.users.carol, true);
    expect(await isFavourite(rootDb, page.id, ids.users.carol)).toBe(true);
    await setFavourite(rootDb, page.id, ids.users.carol, false);
    expect(await isFavourite(rootDb, page.id, ids.users.carol)).toBe(false);
    expect(await prisma.documentFavourite.count()).toBe(0);
  });

  it("an unknown page is NotFoundError", async () => {
    await expect(setWatching(rootDb, "nope", ids.users.bob, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setFavourite(rootDb, "nope", ids.users.bob, true)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("presence (RD-062)", () => {
  const T = (s: number) => new Date(Date.UTC(2026, 9, 9, 12, 0, s));

  it("lists others whose heartbeat is inside the window, boundary included, never the viewer", async () => {
    const page = await createPageAs("alice", "team");
    await touchPresence(rootDb, page.id, ids.users.alice, T(50));
    await touchPresence(rootDb, page.id, ids.users.bob, T(15)); // exactly at the window start
    await touchPresence(rootDb, page.id, ids.users.carol, T(14)); // one second too old
    const since = T(15); // now = T(60), window 45 s
    expect(await listPresence(rootDb, ids.users.alice, page.id, since)).toEqual([{ id: ids.users.bob, name: "Bob Editor" }]);
    expect((await listPresence(rootDb, ids.users.bob, page.id, since)).map((u) => u.name)).toEqual(["Alice Admin"]);
    expect((await listPresence(rootDb, ids.users.carol, page.id, T(0))).map((u) => u.name)).toEqual(["Alice Admin", "Bob Editor"]);
  });

  it("a heartbeat refreshes the row and never moves it backwards", async () => {
    const page = await createPageAs("alice", "team");
    await touchPresence(rootDb, page.id, ids.users.bob, T(10));
    await touchPresence(rootDb, page.id, ids.users.bob, T(30));
    await touchPresence(rootDb, page.id, ids.users.bob, T(20)); // a late heartbeat from another server
    const row = await prisma.documentPresence.findUniqueOrThrow({ where: { documentId_userId: { documentId: page.id, userId: ids.users.bob } } });
    expect(row.lastSeenAt.toISOString()).toBe(T(30).toISOString());
    expect(await prisma.documentPresence.count()).toBe(1);
  });

  it("prune deletes only rows older than the cutoff, everywhere or on one page", async () => {
    const a = await createPageAs("alice", "team");
    const b = await createPageAs("alice", "team");
    await touchPresence(rootDb, a.id, ids.users.bob, T(0));
    await touchPresence(rootDb, a.id, ids.users.carol, T(30));
    await touchPresence(rootDb, b.id, ids.users.bob, T(0));
    expect(await prunePresence(rootDb, T(0), a.id)).toBe(0); // exclusive
    expect(await prunePresence(rootDb, T(1), a.id)).toBe(1);
    expect(await prisma.documentPresence.count({ where: { documentId: b.id } })).toBe(1);
    expect(await prunePresence(rootDb, T(31))).toBe(2);
    expect(await prisma.documentPresence.count()).toBe(0);
  });

  it("an unknown page is NotFoundError", async () => {
    await expect(touchPresence(rootDb, "nope", ids.users.bob, T(0))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("audit (07 §6)", () => {
  it("appends a row with actor, object, operation and JSON parameters, in the caller's transaction", async () => {
    const page = await createPageAs("alice", "team");
    const at = new Date("2026-10-09T11:11:11.000Z");
    const { id } = await writeAudit(rootDb, {
      actorId: ids.users.alice,
      spaceId: ids.spaces.team,
      objectType: "page",
      objectId: page.id,
      operation: "publish",
      parameters: { version: 2, notifyWatchers: true, watchers: 3, dropped: undefined },
      at,
    });
    const row = await prisma.auditEvent.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ actorId: ids.users.alice, spaceId: ids.spaces.team, objectType: "page", objectId: page.id, operation: "publish" });
    expect(row.parameters).toEqual({ version: 2, notifyWatchers: true, watchers: 3 });
    expect(row.at.toISOString()).toBe(at.toISOString());

    // Rolled back with the transaction that wrote it.
    await transaction(async (tx) => {
      await writeAudit(tx, { actorId: ids.users.alice, spaceId: null, objectType: "page", objectId: "x", operation: "noop", parameters: {} });
      throw new Error("abort");
    }).catch(() => undefined);
    expect(await prisma.auditEvent.count({ where: { operation: "noop" } })).toBe(0);
  });
});
