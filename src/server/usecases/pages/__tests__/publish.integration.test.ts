// publishPage, renamePage, getPageView, getEditorState.
// spec: 08 §3 (GET/PUT/PATCH /pages/{id}), §3.2; RD-055 (publish, conflicts), RD-056 (rename), RD-061, RD-063
import { beforeEach, describe, expect, it } from "vitest";
import { codePointLength } from "@/domain/documents";
import {
  ForbiddenError,
  NotFoundError,
  TitleTakenError,
  TooLargeError,
  ValidationError,
  VersionConflictError,
} from "@/domain/errors";
import { validateDocumentJson } from "@/editor/schema";
import {
  createPage,
  deletePage,
  getEditorState,
  getPageView,
  publishPage,
  renamePage,
  saveDraft,
  setWatching,
} from "@/server/usecases/pages";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";
import { PLAT, TEAM, actors, auditRows, expectError, imageDoc, uploadPng, versionNumbers, type Actors } from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

const publish = (input: Partial<Parameters<typeof publishPage>[3]> & { baseVersion: number }) => ({
  title: "Spec",
  content: paragraphDoc("body"),
  ...input,
});

describe("publishPage", () => {
  it("appends the next version with canonical content, deletes the publisher's draft and audits it", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc("draft"), baseVersion: 1 });
    // Unknown attributes are dropped, defaults filled in: what is stored is the canonical form (RD-063).
    const input = { type: "doc", content: [{ type: "paragraph", attrs: { bogus: 1 }, content: [{ type: "text", text: "hello" }] }] };
    const result = await publishPage(who.bob, TEAM, page.id, {
      title: "  Spec v2 ",
      content: input,
      baseVersion: 1,
      message: "  tidied  ",
      notifyWatchers: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.version).toMatchObject({ number: 2, title: "Spec v2", message: "tidied", current: true, pinned: false, author: { id: who.bob.id } });
    expect(result.version).not.toHaveProperty("pinnedBy");
    expect(result.page).toMatchObject({ title: "Spec v2", currentVersion: 2, hasDraft: false, lastModifiedBy: { id: who.bob.id } });

    const stored = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: page.id, number: 2 } });
    const canonical = validateDocumentJson(input);
    expect(canonical.ok).toBe(true);
    expect(stored.content).toEqual(canonical.ok ? canonical.doc : null);
    expect(JSON.stringify(stored.content)).not.toContain("bogus");
    expect(await prisma.documentDraft.count({ where: { documentId: page.id, userId: who.bob.id } })).toBe(0);

    const audit = (await auditRows(page.id)).find((r) => r.operation === "page.update");
    expect(audit).toMatchObject({ actorId: who.bob.id, objectType: "page" });
    expect(audit?.parameters).toMatchObject({
      version: 2,
      baseVersion: 1,
      overwrite: false,
      overwrote: null,
      title: "Spec v2",
      previousTitle: "Spec",
      message: "tidied",
      notifyWatchers: true,
      draftDeleted: true,
    });
  });

  it("records how many OTHER watchers who can still view the page a notification would reach (RD-061)", async () => {
    const page = await createPage(who.alice, TEAM, { title: "Watched" }); // alice watches as creator
    await setWatching(who.carol, TEAM, page.id, true);
    await setWatching(who.bob, TEAM, page.id, true);
    await publishPage(who.bob, TEAM, page.id, publish({ title: "Watched", baseVersion: 1 }));
    const audit = (await auditRows(page.id)).find((r) => r.operation === "page.update");
    expect(audit?.parameters).toMatchObject({ watcherCount: 2, notifyWatchers: false });
  });

  it("refuses a stale base with VERSION_CONFLICT carrying the current number, and writes nothing", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    const error = await expectError(publishPage(who.bob, TEAM, page.id, publish({ baseVersion: 1 })), VersionConflictError);
    expect(error.currentVersion).toBe(3);
    // A base that does not exist yet is just as stale.
    await expectError(publishPage(who.bob, TEAM, page.id, publish({ baseVersion: 9 })), VersionConflictError);
    expect(await versionNumbers(page.id)).toEqual([1, 2, 3]);
    expect(await auditRows(page.id)).toEqual([]);
  });

  it("publishes over a newer version with overwrite, as a new version on top", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    const result = await publishPage(who.bob, TEAM, page.id, publish({ baseVersion: 1, overwrite: true }));
    expect(result.version.number).toBe(3);
    const audit = (await auditRows(page.id)).find((r) => r.operation === "page.update");
    expect(audit?.parameters).toMatchObject({ overwrite: true, overwrote: 2, baseVersion: 1 });
  });

  it("lets exactly one of two concurrent publishes from the same base win; numbers stay unique and dense", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const results = await Promise.allSettled([
      publishPage(who.alice, TEAM, page.id, publish({ content: paragraphDoc("alice"), baseVersion: 1 })),
      publishPage(who.bob, TEAM, page.id, publish({ content: paragraphDoc("bob"), baseVersion: 1 })),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(VersionConflictError);
    expect((lost[0]?.reason as VersionConflictError).currentVersion).toBe(2);
    expect(await versionNumbers(page.id)).toEqual([1, 2]);
    expect((await auditRows(page.id)).filter((r) => r.operation === "page.update")).toHaveLength(1);
  });

  it("serialises many concurrent overwrites into dense, unique version numbers", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        publishPage(i % 2 ? who.alice : who.bob, TEAM, page.id, publish({ content: paragraphDoc(`n${i}`), baseVersion: 1, overwrite: true })),
      ),
    );
    expect(await versionNumbers(page.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const row = await prisma.document.findUniqueOrThrow({ where: { id: page.id }, include: { currentVersion: true } });
    expect(row.currentVersion?.number).toBe(7);
  });

  it.each([
    ["an empty title", { title: "  " }, "title"],
    ["a title with a newline inside", { title: "a\nb" }, "title"],
    ["a 256-character title", { title: "x".repeat(256) }, "title"],
    ["a change note over 500 characters", { message: "y".repeat(501) }, "message"],
    ["a change note with U+0000", { message: "a\u0000b" }, "message"],
    ["content that is not a document", { content: { type: "paragraph" } }, "content"],
  ])("refuses %s with VALIDATION at that field", async (_label, over, path) => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const error = await expectError(publishPage(who.alice, TEAM, page.id, publish({ ...over, baseVersion: 1 })), ValidationError);
    expect(error.errors.length).toBeGreaterThan(0);
    for (const e of error.errors) expect(e.path === path || e.path.startsWith(`${path}.`)).toBe(true);
    expect(await versionNumbers(page.id)).toEqual([1]);
  });

  it("counts the change note in code points: 500 astral characters are allowed", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const note = "😀".repeat(500);
    expect(codePointLength(note)).toBe(500);
    const result = await publishPage(who.alice, TEAM, page.id, publish({ message: note, baseVersion: 1 }));
    expect(result.version.message).toBe(note);
  });

  it("reports a content rule's path inside content", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const bad = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] };
    const error = await expectError(publishPage(who.alice, TEAM, page.id, publish({ content: bad, baseVersion: 1 })), ValidationError);
    expect(error.errors[0]?.path).toMatch(/^content\.content\.0\.content\.0\.marks\.0/);
  });

  it("refuses content over 5 MiB with TOO_LARGE carrying the limit", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const huge = paragraphDoc("x".repeat(5 * 1024 * 1024));
    const error = await expectError(publishPage(who.alice, TEAM, page.id, publish({ content: huge, baseVersion: 1 })), TooLargeError);
    expect(error.limit).toBe(5_242_880);
  });

  it("allows images of this page's attachments only (RD-058)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const other = await createPageAs("alice", "team", { title: "Other" });
    const own = await uploadPng(who.alice, TEAM, page.id);
    const foreign = await uploadPng(who.alice, TEAM, other.id);
    await expect(publishPage(who.alice, TEAM, page.id, publish({ content: imageDoc(own), baseVersion: 1 }))).resolves.toBeDefined();
    const error = await expectError(publishPage(who.alice, TEAM, page.id, publish({ content: imageDoc(foreign), baseVersion: 2 })), ValidationError);
    expect(error.errors[0]?.path).toMatch(/^content\.content\.1\.content\.0\.attrs/);
  });

  it("refuses a title another live page has with TITLE_TAKEN, and writes nothing", async () => {
    await createPageAs("alice", "team", { title: "Taken" });
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(publishPage(who.alice, TEAM, page.id, publish({ title: "TAKEN", baseVersion: 1 })), TitleTakenError);
    expect(await versionNumbers(page.id)).toEqual([1]);
    expect(await auditRows(page.id)).toEqual([]);
  });

  it("is NotFound for a deleted page, a malformed id, and a page of another space (IDOR)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await deletePage(who.alice, TEAM, page.id);
    await expectError(publishPage(who.alice, TEAM, page.id, publish({ baseVersion: 1 })), NotFoundError);
    await expectError(publishPage(who.alice, TEAM, "../../x", publish({ baseVersion: 1 })), NotFoundError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    // Bob can edit TEAM but only view PLAT: TEAM's URL must not let him write a PLAT page.
    await expectError(publishPage(who.bob, TEAM, plat.id, publish({ title: "Plat", baseVersion: 1 })), NotFoundError);
    expect(await versionNumbers(plat.id)).toEqual([1]);
  });

  it("needs EDIT", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(publishPage(who.carol, TEAM, page.id, publish({ baseVersion: 1 })), ForbiddenError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(publishPage(who.bob, PLAT, plat.id, publish({ title: "Plat", baseVersion: 1 })), ForbiddenError);
    await expectError(publishPage(who.carol, PLAT, plat.id, publish({ title: "Plat", baseVersion: 1 })), NotFoundError);
  });
});

describe("renamePage", () => {
  it("creates a version with the same content, the new title and the note Renamed from \"<old>\"", async () => {
    const page = await createPageAs("alice", "team", { title: "Old name", versions: 2 });
    const renamed = await renamePage(who.bob, TEAM, page.id, { title: " New name " });
    expect(renamed).toMatchObject({ title: "New name", currentVersion: 3 });
    const [v2, v3] = await Promise.all([
      prisma.documentVersion.findFirstOrThrow({ where: { documentId: page.id, number: 2 } }),
      prisma.documentVersion.findFirstOrThrow({ where: { documentId: page.id, number: 3 } }),
    ]);
    expect(v3).toMatchObject({ title: "New name", message: 'Renamed from "Old name"', authorId: who.bob.id });
    expect(v3.content).toEqual(v2.content);
    const audit = (await auditRows(page.id)).find((r) => r.operation === "page.rename");
    expect(audit?.parameters).toEqual({ from: "Old name", to: "New name", version: 3 });
  });

  it("changes nothing for a rename to the current title, but does rename a change of case", async () => {
    const page = await createPageAs("alice", "team", { title: "Name" });
    expect((await renamePage(who.alice, TEAM, page.id, { title: "Name " })).currentVersion).toBe(1);
    expect(await auditRows(page.id)).toEqual([]);
    expect((await renamePage(who.alice, TEAM, page.id, { title: "NAME" })).currentVersion).toBe(2);
  });

  it("refuses an invalid or taken title, and needs EDIT", async () => {
    await createPageAs("alice", "team", { title: "Taken" });
    const page = await createPageAs("alice", "team", { title: "Name" });
    await expectError(renamePage(who.alice, TEAM, page.id, { title: "" }), ValidationError);
    await expectError(renamePage(who.alice, TEAM, page.id, { title: "taken" }), TitleTakenError);
    await expectError(renamePage(who.carol, TEAM, page.id, { title: "Mine" }), ForbiddenError);
    expect(await versionNumbers(page.id)).toEqual([1]);
  });
});

describe("getPageView", () => {
  it("returns the page for the caller and the current version, or a past one", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    const view = await getPageView(who.carol, TEAM, page.id);
    expect(view.space.key).toBe(TEAM);
    expect(view.page).toMatchObject({ id: page.id, currentVersion: 2, watching: false, permissions: { canEdit: false, canAdmin: false } });
    expect(view.version).toMatchObject({ number: 2, current: true, content: paragraphDoc("Spec v2") });
    const past = await getPageView(who.carol, TEAM, page.id, 1);
    expect(past.version).toMatchObject({ number: 1, current: false, content: paragraphDoc("Spec v1") });
    expect(past.page.currentVersion).toBe(2);
  });

  it("is NotFound for an unknown version, and for a page the caller cannot see or that is deleted", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(getPageView(who.alice, TEAM, page.id, 2), NotFoundError);
    await expectError(getPageView(who.alice, TEAM, page.id, 0), NotFoundError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(getPageView(who.carol, PLAT, plat.id), NotFoundError);
    // The IDOR check: carol can view TEAM, and must not read a PLAT page through TEAM's key.
    await expectError(getPageView(who.carol, TEAM, plat.id), NotFoundError);
    await deletePage(who.alice, TEAM, page.id);
    await expectError(getPageView(who.alice, TEAM, page.id), NotFoundError);
  });
});

describe("getEditorState", () => {
  it("opens from the current version when the caller has no draft", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    const state = await getEditorState(who.bob, TEAM, page.id);
    expect(state.initial).toEqual({ title: "Spec", content: paragraphDoc("Spec v2"), baseVersion: 2, fromDraft: false });
    expect(state.page.hasDraft).toBe(false);
  });

  it("resumes the caller's own draft — and only theirs", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec (draft)", content: paragraphDoc("wip"), baseVersion: 1 });
    const bob = await getEditorState(who.bob, TEAM, page.id);
    expect(bob.initial).toMatchObject({ title: "Spec (draft)", content: paragraphDoc("wip"), baseVersion: 1, fromDraft: true });
    expect(bob.page.hasDraft).toBe(true);
    expect((await getEditorState(who.alice, TEAM, page.id)).initial.fromDraft).toBe(false);
  });

  it("needs EDIT", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(getEditorState(who.carol, TEAM, page.id), ForbiddenError);
  });
});
