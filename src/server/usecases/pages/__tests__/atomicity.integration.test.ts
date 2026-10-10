// Every state change runs in ONE transaction with its audit row (07 §6; the transaction
// boundary lives in the use case). Failures are induced inside the database by a trigger that
// raises on one specific write — after earlier writes of the same use case have succeeded — and
// the test checks that nothing of the operation survives: no version, no draft change, no page,
// no attachment, no watch, no audit row.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyPage, createPage, publishPage, renamePage, restoreVersion, saveDraft, uploadAttachment } from "@/server/usecases/pages";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";
import { TEAM, actors, auditRows, imageDoc, pngBytes, rejection, uploadPng, versionNumbers, type Actors } from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

const TRIGGER = "rf_test_induced_failure";

/** Makes the next matching write fail inside the database. `when` is a trigger WHEN condition. */
async function failOn(table: string, event: "INSERT" | "DELETE", when = "true"): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'induced failure for a test'; END $$`);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${TRIGGER} BEFORE ${event} ON "${table}" FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${TRIGGER}()`,
  );
  failingTable = table;
}

let failingTable: string | null = null;
afterEach(async () => {
  if (failingTable !== null) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "${failingTable}"`);
  failingTable = null;
});

async function snapshot() {
  const [documents, versions, drafts, attachments, watches, audits] = await Promise.all([
    prisma.document.findMany({ orderBy: { id: "asc" }, select: { id: true, title: true, currentVersionId: true, ordinal: true, deletedAt: true } }),
    prisma.documentVersion.findMany({ orderBy: { id: "asc" }, select: { id: true, number: true, title: true } }),
    prisma.documentDraft.findMany({ orderBy: [{ documentId: "asc" }, { userId: "asc" }] }),
    prisma.attachment.findMany({ orderBy: { id: "asc" }, select: { id: true, documentId: true, deletedAt: true } }),
    prisma.documentWatch.findMany({ orderBy: [{ documentId: "asc" }, { userId: "asc" }] }),
    prisma.auditEvent.count(),
  ]);
  return { documents, versions, drafts, attachments, watches, audits };
}

describe("publishPage is atomic", () => {
  it.each([
    ["writing the audit row (after the version and the draft deletion)", "AuditEvent", "INSERT" as const, `NEW."operation" = 'page.update'`],
    ["deleting the draft (after the version is inserted)", "DocumentDraft", "DELETE" as const, "true"],
  ])("a failure while %s leaves no version, the draft intact and no audit row", async (_label, table, event, when) => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(who.bob, TEAM, page.id, { title: "Spec", content: paragraphDoc("draft"), baseVersion: 1 });
    const before = await snapshot();
    await failOn(table, event, when);

    expect(await rejection(publishPage(who.bob, TEAM, page.id, { title: "Spec v2", content: paragraphDoc("new"), baseVersion: 1 }))).toBeInstanceOf(Error);

    expect(await snapshot()).toEqual(before);
    expect(await versionNumbers(page.id)).toEqual([1]);
    expect(await prisma.documentDraft.count({ where: { documentId: page.id, userId: who.bob.id } })).toBe(1);
  });
});

describe("copyPage is atomic", () => {
  it.each([
    ["writing the audit row (after page, attachments, version and watch)", "AuditEvent", `NEW."operation" = 'page.copy'`],
    ["adding the copier's watch (after page, attachments and version)", "DocumentWatch", "true"],
    ["inserting the copy's first version (after page and attachments)", "DocumentVersion", `NEW."title" = 'Copy of Spec'`],
  ])("a failure while %s leaves no page, no attachment, no version, no watch and no audit row", async (_label, table, when) => {
    const source = await createPage(who.alice, TEAM, { title: "Spec" });
    const image = await uploadPng(who.alice, TEAM, source.id);
    await publishPage(who.alice, TEAM, source.id, { title: "Spec", content: imageDoc(image), baseVersion: 1 });
    const before = await snapshot();
    await failOn(table, "INSERT", when);

    expect(await rejection(copyPage(who.bob, TEAM, source.id))).toBeInstanceOf(Error);

    expect(await snapshot()).toEqual(before);
  });
});

describe("the other state changes are atomic too", () => {
  it("createPage: a failed audit leaves no page and no version", async () => {
    const before = await snapshot();
    await failOn("AuditEvent", "INSERT", `NEW."operation" = 'page.create'`);
    expect(await rejection(createPage(who.alice, TEAM, { title: "New" }))).toBeInstanceOf(Error);
    expect(await snapshot()).toEqual(before);
  });

  it("renamePage and restoreVersion: a failed audit leaves no version and the old title", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    const before = await snapshot();
    await failOn("AuditEvent", "INSERT");
    expect(await rejection(renamePage(who.alice, TEAM, page.id, { title: "Renamed" }))).toBeInstanceOf(Error);
    expect(await rejection(restoreVersion(who.alice, TEAM, page.id, 1))).toBeInstanceOf(Error);
    expect(await snapshot()).toEqual(before);
  });

  it("uploadAttachment: a failed audit leaves no attachment", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const before = await snapshot();
    await failOn("AuditEvent", "INSERT", `NEW."operation" = 'attachment.upload'`);
    expect(await rejection(uploadAttachment(who.alice, TEAM, page.id, { filename: "a.png", bytes: pngBytes() }))).toBeInstanceOf(Error);
    expect(await snapshot()).toEqual(before);
  });

  it("the trigger really fires, and is gone afterwards (the harness is not vacuous)", async () => {
    await failOn("AuditEvent", "INSERT");
    expect(await rejection(createPage(who.alice, TEAM))).toBeInstanceOf(Error);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "AuditEvent"`);
    failingTable = null;
    await expect(createPage(who.alice, TEAM)).resolves.toMatchObject({ title: "Untitled" });
    expect(await auditRows()).toHaveLength(1);
  });
});
