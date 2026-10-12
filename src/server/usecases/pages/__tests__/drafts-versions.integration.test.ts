// getDraft, saveDraft, discardDraft; listVersions, getVersion, restoreVersion, deleteVersion, compareVersions.
// spec: 08 §3 (draft and versions endpoints), §3.2; RD-055 (drafts), RD-060 (history), RD-066
import { beforeEach, describe, expect, it } from "vitest";
import {
  CurrentVersionError,
  ForbiddenError,
  NotFoundError,
  PinnedVersionError,
  TitleTakenError,
  TooLargeError,
  ValidationError,
} from "@/domain/errors";
import {
  compareVersions,
  deletePage,
  deleteVersion,
  discardDraft,
  getDraft,
  getVersion,
  hideAttachment,
  listVersions,
  publishPage,
  renamePage,
  restoreVersion,
  saveDraft,
} from "@/server/usecases/pages";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";
import { imageAttachmentIds } from "../copy-content";
import { PLAT, TEAM, actors, auditRows, expectError, imageDoc, uploadPng, versionNumbers, type Actors } from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

describe("drafts (RD-055)", () => {
  it("saves, reads back and replaces the caller's own draft, never creating history", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const saved = await saveDraft(who.bob, TEAM, page.id, { title: " Spec WIP ", content: paragraphDoc("one"), baseVersion: 1 });
    expect(saved).toMatchObject({ stale: false, currentVersion: 1 });
    expect(Number.isNaN(Date.parse(saved.savedAt))).toBe(false);
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec WIP", content: paragraphDoc("two"), baseVersion: 1 });
    expect(await getDraft(who.bob, TEAM, page.id)).toMatchObject({
      title: "Spec WIP",
      content: paragraphDoc("two"),
      baseVersion: 1,
      stale: false,
      currentVersion: 1,
    });
    expect(await getDraft(who.alice, TEAM, page.id)).toBeNull();
    expect(await versionNumbers(page.id)).toEqual([1]);
    expect(await auditRows(page.id)).toEqual([]);
  });

  it("allows an empty title while typing, and normalises it; refuses one over 255 or with U+0000", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(who.bob, TEAM, page.id, { title: "   ", content: paragraphDoc(), baseVersion: 1 });
    expect((await getDraft(who.bob, TEAM, page.id))?.title).toBe("");
    // A tab is fine mid-edit (publish refuses it); only what the database cannot hold is refused.
    await saveDraft(who.bob, TEAM, page.id, { title: "a\tb", content: paragraphDoc(), baseVersion: 1 });
    for (const title of ["x".repeat(256), "a\u0000b"]) {
      const error = await expectError(saveDraft(who.bob, TEAM, page.id, { title, content: paragraphDoc(), baseVersion: 1 }), ValidationError);
      expect(error.errors.map((e) => e.path)).toEqual(["title"]);
    }
  });

  it("validates content exactly like a publish", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const error = await expectError(
      saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: { type: "doc", content: [{ type: "nope" }] }, baseVersion: 1 }),
      ValidationError,
    );
    expect(error.errors[0]?.path.startsWith("content")).toBe(true);
    const big = await expectError(
      saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc("x".repeat(5_300_000)), baseVersion: 1 }),
      TooLargeError,
    );
    expect(big.limit).toBe(5_242_880);
    await expectError(saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc(), baseVersion: 0 }), ValidationError);
    expect(await prisma.documentDraft.count()).toBe(0);
  });

  it("lets images reference this page's attachments only, exactly like a publish (RD-058)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const other = await createPageAs("alice", "team", { title: "Other" });
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    const own = await uploadPng(who.alice, TEAM, page.id, "own.png");
    const hidden = await uploadPng(who.alice, TEAM, page.id, "hidden.png");
    await hideAttachment(who.alice, TEAM, page.id, hidden.id);
    const sameSpace = await uploadPng(who.alice, TEAM, other.id, "same-space.png");
    const otherSpace = await uploadPng(who.alice, PLAT, plat.id, "other-space.png");

    // The page's own attachments, hidden ones included (old versions still show them).
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: imageDoc(own, hidden), baseVersion: 1 });
    for (const foreign of [sameSpace, otherSpace]) {
      const error = await expectError(
        saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: imageDoc(own, foreign), baseVersion: 1 }),
        ValidationError,
      );
      expect(error.errors.map((e) => e.path)).toEqual([expect.stringMatching(/^content\.content\.1\.content\.1\.attrs/)]);
    }
    // The refused saves stored nothing: the draft the editor would open is still the valid one.
    const draft = await getDraft(who.bob, TEAM, page.id);
    expect(imageAttachmentIds(draft?.content)).toEqual(new Set([own.id, hidden.id]));
  });

  it("saves over a stale base and reports it stale, rather than refusing", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    const saved = await saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc("old"), baseVersion: 1 });
    expect(saved).toMatchObject({ stale: true, currentVersion: 3 });
    expect(await getDraft(who.bob, TEAM, page.id)).toMatchObject({ stale: true, baseVersion: 1, currentVersion: 3 });
  });

  it("becomes stale when someone else publishes", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc("mine"), baseVersion: 1 });
    await publishPage(who.alice, TEAM, page.id, { title: "Spec", content: paragraphDoc("theirs"), baseVersion: 1 });
    expect(await getDraft(who.bob, TEAM, page.id)).toMatchObject({ stale: true, currentVersion: 2 });
  });

  it("discard is idempotent and only removes the caller's draft", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(who.bob, TEAM, page.id, { title: "b", content: paragraphDoc(), baseVersion: 1 });
    await saveDraft(who.alice, TEAM, page.id, { title: "a", content: paragraphDoc(), baseVersion: 1 });
    await discardDraft(who.bob, TEAM, page.id);
    await discardDraft(who.bob, TEAM, page.id);
    expect(await getDraft(who.bob, TEAM, page.id)).toBeNull();
    expect(await getDraft(who.alice, TEAM, page.id)).not.toBeNull();
  });

  it("audits a discard that removed a draft (07 §6), and nothing for a discard with nothing to remove", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    await discardDraft(who.bob, TEAM, page.id);
    expect(await auditRows(page.id)).toEqual([]);
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc("wip"), baseVersion: 2 });
    await discardDraft(who.bob, TEAM, page.id);
    await discardDraft(who.bob, TEAM, page.id);
    const rows = await auditRows(page.id);
    expect(rows.map((r) => [r.operation, r.objectType, r.actorId])).toEqual([["page.discard-draft", "page", who.bob.id]]);
    expect(rows[0]?.parameters).toEqual({ baseVersion: 2 });
  });

  it("needs EDIT for all three, and is NotFound across spaces", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(getDraft(who.carol, TEAM, page.id), ForbiddenError);
    await expectError(saveDraft(who.carol, TEAM, page.id, { title: "c", content: paragraphDoc(), baseVersion: 1 }), ForbiddenError);
    await expectError(discardDraft(who.carol, TEAM, page.id), ForbiddenError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(saveDraft(who.alice, TEAM, plat.id, { title: "x", content: paragraphDoc(), baseVersion: 1 }), NotFoundError);
    await expectError(getDraft(who.bob, PLAT, plat.id), ForbiddenError);
  });
});

describe("listVersions and getVersion", () => {
  it("lists newest first with current marked, and reads one with its content", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    const list = await listVersions(who.carol, TEAM, page.id);
    expect(list.map((v) => [v.number, v.current, v.message])).toEqual([
      [3, true, "edit 3"],
      [2, false, "edit 2"],
      [1, false, null],
    ]);
    expect(list[0]).not.toHaveProperty("pinnedBy");
    expect(list[0]).not.toHaveProperty("content");
    expect(await getVersion(who.carol, TEAM, page.id, 2)).toMatchObject({ number: 2, current: false, content: paragraphDoc("Spec v2") });
  });

  it("is NotFound for an unknown or malformed number, an invisible space, and across spaces", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(getVersion(who.alice, TEAM, page.id, 2), NotFoundError);
    await expectError(getVersion(who.alice, TEAM, page.id, 1.5), NotFoundError);
    await expectError(getVersion(who.alice, TEAM, page.id, -1), NotFoundError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(listVersions(who.carol, PLAT, plat.id), NotFoundError);
    await expectError(listVersions(who.carol, TEAM, plat.id), NotFoundError);
    await expect(listVersions(who.bob, PLAT, plat.id)).resolves.toHaveLength(1);
  });
});

describe("restoreVersion (RD-060)", () => {
  it("creates a NEW version with the old title and content and the note Restored from v. N", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    await renamePage(who.alice, TEAM, page.id, { title: "Renamed" });
    const result = await restoreVersion(who.bob, TEAM, page.id, 1);
    expect(result.version).toMatchObject({ number: 4, title: "Spec", message: "Restored from v. 1", current: true, author: { id: who.bob.id } });
    expect(result.page).toMatchObject({ title: "Spec", currentVersion: 4 });
    expect(result.diagnostics).toEqual([]);
    const v4 = await getVersion(who.bob, TEAM, page.id, 4);
    expect(v4.content).toEqual(paragraphDoc("Spec v1"));
    expect(await versionNumbers(page.id)).toEqual([1, 2, 3, 4]);
    const audit = (await auditRows(page.id)).find((r) => r.operation === "page.restore-version");
    expect(audit?.parameters).toMatchObject({ restoredFrom: 1, version: 4, previousVersion: 3 });
  });

  it("is TITLE_TAKEN when the old title now belongs to another live page", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await renamePage(who.alice, TEAM, page.id, { title: "Renamed" });
    await createPageAs("alice", "team", { title: "spec" });
    await expectError(restoreVersion(who.alice, TEAM, page.id, 1), TitleTakenError);
    expect(await versionNumbers(page.id)).toEqual([1, 2]);
  });

  it("needs EDIT and an existing version", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    await expectError(restoreVersion(who.carol, TEAM, page.id, 1), ForbiddenError);
    await expectError(restoreVersion(who.alice, TEAM, page.id, 7), NotFoundError);
  });
});

describe("deleteVersion (RD-060)", () => {
  it("deletes one non-current, non-pinned version and audits it", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    await deleteVersion(who.alice, TEAM, page.id, 2);
    expect(await versionNumbers(page.id)).toEqual([1, 3]);
    const audit = (await auditRows(page.id)).find((r) => r.operation === "page.delete-version");
    expect(audit).toMatchObject({ actorId: who.alice.id });
    expect(audit?.parameters).toMatchObject({ version: 2, title: "Spec" });
    // Numbers are never reused: the next publish is 4.
    const next = await publishPage(who.alice, TEAM, page.id, { title: "Spec", content: paragraphDoc("x"), baseVersion: 3 });
    expect(next.version.number).toBe(4);
  });

  it("refuses the current version (CURRENT_VERSION) and a pinned one (PINNED_VERSION)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    await expectError(deleteVersion(who.alice, TEAM, page.id, 3), CurrentVersionError);
    await prisma.documentVersion.updateMany({ where: { documentId: page.id, number: 1 }, data: { pinned: true } });
    await expectError(deleteVersion(who.alice, TEAM, page.id, 1), PinnedVersionError);
    expect(await versionNumbers(page.id)).toEqual([1, 2, 3]);
    expect((await auditRows(page.id)).filter((r) => r.operation === "page.delete-version")).toEqual([]);
    expect((await listVersions(who.alice, TEAM, page.id)).find((v) => v.number === 1)?.pinned).toBe(true);
  });

  it("needs ADMIN: an editor is refused with 403", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    await expectError(deleteVersion(who.bob, TEAM, page.id, 1), ForbiddenError);
    await expectError(deleteVersion(who.carol, TEAM, page.id, 1), ForbiddenError);
    await expectError(deleteVersion(who.alice, TEAM, page.id, 9), NotFoundError);
    expect(await versionNumbers(page.id)).toEqual([1, 2]);
  });

  it("is NotFound for a deleted page", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    await deletePage(who.alice, TEAM, page.id);
    await expectError(deleteVersion(who.alice, TEAM, page.id, 1), NotFoundError);
  });
});

describe("compareVersions (RD-060)", () => {
  it("returns both versions and the classified top-level blocks", async () => {
    const page = await createPageAs("alice", "team", {
      title: "Spec",
      versions: 2,
      content: (n) => (n === 1 ? paragraphDoc("same", "old") : paragraphDoc("same", "new", "added")),
    });
    const cmp = await compareVersions(who.carol, TEAM, page.id, 1, 2);
    expect(cmp.left.number).toBe(1);
    expect(cmp.right.number).toBe(2);
    expect(cmp.page.id).toBe(page.id);
    expect(cmp.blocks.map((b) => b.status)).toEqual(["same", "changed", "added"]);
    // An ordinary comparison is exact; the flag exists for RD-066's work cap.
    expect(cmp.approximate).toBe(false);
  });

  it("is NotFound when either version is missing", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(compareVersions(who.alice, TEAM, page.id, 1, 2), NotFoundError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(compareVersions(who.carol, PLAT, plat.id, 1, 1), NotFoundError);
  });
});
