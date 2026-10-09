// mapDbError: every database refusal of the documents migrations, in every shape Prisma
// delivers it (ORM P2002/P2003, raw P2010, UnknownRequestError for triggers and CHECKs),
// becomes the typed error of spec 08 §3.2 — and anything else passes through untouched.
import { beforeEach, describe, expect, it } from "vitest";
import {
  CurrentVersionError,
  CycleError,
  NotFoundError,
  PinnedVersionError,
  TitleTakenError,
  ValidationError,
} from "@/domain/errors";
import { insertAttachment } from "@/server/repositories/attachments";
import { inspectDbError, mapDbError } from "@/server/repositories/db-errors";
import { upsertDraft } from "@/server/repositories/drafts";
import { rootDb } from "@/server/repositories/transaction";
import { buildTree, createPageAs, demoIds, paragraphDoc, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

let ids: DemoIds;
beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the database to refuse");
}

const mapped = async (p: Promise<unknown>) => mapDbError(await failure(p));

describe("mapDbError", () => {
  it("unique live title → TitleTakenError (ORM P2002 and raw P2010)", async () => {
    await createPageAs("alice", "team", { title: "Same" });
    const orm = await mapped(prisma.document.create({ data: { spaceId: ids.spaces.team, title: "same", createdById: ids.users.alice } }));
    const raw = await mapped(prisma.$executeRaw`
      INSERT INTO "Document" ("id", "spaceId", "title", "createdById") VALUES ('x', ${ids.spaces.team}, 'SAME', ${ids.users.alice})`);
    expect(orm).toBeInstanceOf(TitleTakenError);
    expect(raw).toBeInstanceOf(TitleTakenError);
  });

  it("tree guard: self-parent and descendant → CycleError; another space → ValidationError(parentId)", async () => {
    const t = await buildTree("alice", "team", [{ title: "A", children: [{ title: "B" }] }]);
    const plat = await createPageAs("alice", "plat");
    expect(await mapped(prisma.document.update({ where: { id: t.A! }, data: { parentId: t.A! } }))).toBeInstanceOf(CycleError);
    expect(await mapped(prisma.$executeRaw`UPDATE "Document" SET "parentId" = ${t.B!} WHERE "id" = ${t.A!}`)).toBeInstanceOf(CycleError);
    const cross = await mapped(prisma.document.update({ where: { id: t.B! }, data: { parentId: plat.id } }));
    expect(cross).toBeInstanceOf(ValidationError);
    expect((cross as ValidationError).errors[0]?.path).toBe("parentId");
    const move = await mapped(prisma.document.update({ where: { id: t.A! }, data: { spaceId: ids.spaces.plat } }));
    expect((move as ValidationError).errors[0]?.path).toBe("spaceId");
  });

  it("pinned version delete → PinnedVersionError (ORM and raw)", async () => {
    const page = await createPageAs("alice", "team", { versions: 2 });
    const v1 = page.versions[0]!.id;
    await prisma.documentVersion.update({ where: { id: v1 }, data: { pinned: true } });
    expect(await mapped(prisma.documentVersion.delete({ where: { id: v1 } }))).toBeInstanceOf(PinnedVersionError);
    expect(await mapped(prisma.$executeRaw`DELETE FROM "DocumentVersion" WHERE "id" = ${v1}`)).toBeInstanceOf(PinnedVersionError);
    expect(await mapped(prisma.document.delete({ where: { id: page.id } }))).toBeInstanceOf(PinnedVersionError);
  });

  it("current version delete → CurrentVersionError (ORM P2003 and raw), but a dangling pointer is not", async () => {
    const page = await createPageAs("alice", "team");
    const v1 = page.versions[0]!.id;
    expect(await mapped(prisma.documentVersion.delete({ where: { id: v1 } }))).toBeInstanceOf(CurrentVersionError);
    expect(await mapped(prisma.$executeRaw`DELETE FROM "DocumentVersion" WHERE "id" = ${v1}`)).toBeInstanceOf(CurrentVersionError);
    // Writing the referencing side: the guard trigger fires first. Not a user error → unmapped.
    const other = await mapped(prisma.document.update({ where: { id: page.id }, data: { currentVersionId: "no-such-version" } }));
    expect(other).not.toBeInstanceOf(CurrentVersionError);
  });

  it("CHECK constraints → ValidationError naming the field (ORM UnknownRequestError and raw)", async () => {
    const orm = await mapped(prisma.document.create({ data: { spaceId: ids.spaces.team, title: " ", createdById: ids.users.alice } }));
    expect((orm as ValidationError).errors).toEqual([{ path: "title", message: expect.any(String) }]);
    const page = await createPageAs("alice", "team");
    const raw = await mapped(prisma.$executeRaw`
      INSERT INTO "DocumentVersion" ("id", "documentId", "number", "title", "content", "authorId", "message")
      VALUES ('v', ${page.id}, 9, 'T', '{}'::jsonb, ${ids.users.alice}, ${"m".repeat(501)})`);
    expect((raw as ValidationError).errors[0]?.path).toBe("message");
  });

  it("a missing referenced page or user on insert → NotFoundError", async () => {
    const page = await createPageAs("alice", "team");
    expect(
      await mapped(prisma.documentDraft.create({ data: { documentId: "nope", userId: ids.users.bob, title: "", content: {}, baseVersionNumber: 1 } })),
    ).toBeInstanceOf(NotFoundError);
    expect(await mapped(prisma.$executeRaw`INSERT INTO "DocumentWatch" ("documentId", "userId") VALUES (${page.id}, 'no-such-user')`)).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("immutability violations are bugs, not user errors: they pass through unchanged", async () => {
    const page = await createPageAs("alice", "team");
    const e = await failure(prisma.documentVersion.update({ where: { id: page.versions[0]!.id }, data: { title: "x" } }));
    expect(mapDbError(e)).toBe(e);
    expect(inspectDbError(e)?.sqlState).toBe("23514");
  });

  it("non-database errors pass through unchanged", () => {
    const e = new Error("boom");
    expect(mapDbError(e)).toBe(e);
    expect(mapDbError("text")).toBe("text");
    expect(inspectDbError(e)).toBeNull();
  });
});

// PostgreSQL's DETAIL "Failing row contains (…)" and "Key (…)=(…)" echo the row's values —
// titles and filenames, i.e. user content. Each string below names a trigger message or a
// constraint mapDbError knows; none may steer which typed error comes back (08 §3.2). Kept
// under 64 characters: PostgreSQL truncates each value in the DETAIL beyond that.
describe("mapDbError ignores user content echoed in DETAIL", () => {
  const HOSTILE = [
    "pinned by a baseline",
    "document_tree_guard: own parent",
    "document_tree_guard: the parent must be in the same space",
    'violates check constraint "Document_title_length"',
    "Attachment_size_matches Document_live_spaceId_title_key",
  ];

  it.each(HOSTILE)("a draft with base 0 and title %j → ValidationError(baseVersion), ORM and raw", async (title) => {
    const page = await createPageAs("alice", "team");
    const orm = await failure(
      upsertDraft(rootDb, { documentId: page.id, userId: ids.users.bob, title, content: paragraphDoc(), baseVersionNumber: 0 }),
    );
    expect(orm).toBeInstanceOf(ValidationError);
    expect((orm as ValidationError).errors).toEqual([{ path: "baseVersion", message: expect.any(String) }]);

    const raw = await mapped(prisma.$executeRaw`
      INSERT INTO "DocumentDraft" ("documentId", "userId", "title", "content", "baseVersionNumber", "updatedAt")
      VALUES (${page.id}, ${ids.users.bob}, ${title}, '{}'::jsonb, 0, now())`);
    expect(raw).toBeInstanceOf(ValidationError);
    expect((raw as ValidationError).errors).toEqual([{ path: "baseVersion", message: expect.any(String) }]);
  });

  it.each(["Attachment_size_matches.png", "pinned by a baseline.png"])(
    "an attachment with content type 'x' and filename %j → ValidationError(contentType)",
    async (filename) => {
      const page = await createPageAs("alice", "team");
      const e = await failure(
        insertAttachment(rootDb, { documentId: page.id, filename, contentType: "x", data: new Uint8Array([1, 2, 3]), uploadedById: ids.users.bob }),
      );
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors).toEqual([{ path: "contentType", message: expect.any(String) }]);
    },
  );

  it("a unique violation elsewhere whose key value mentions lower(title) is not TitleTakenError", async () => {
    await prisma.$executeRaw`INSERT INTO "Group" ("id", "name") VALUES ('g-hostile-1', 'lower(title) Document_live_spaceId_title_key')`;
    const e = await failure(prisma.$executeRaw`
      INSERT INTO "Group" ("id", "name") VALUES ('g-hostile-2', 'lower(title) Document_live_spaceId_title_key')`);
    expect(inspectDbError(e)?.sqlState).toBe("23505");
    expect(mapDbError(e)).toBe(e);
  });

  it("a real title collision is still TitleTakenError when the title itself is hostile (ORM and raw)", async () => {
    const title = 'violates check constraint "DocumentDraft_base_positive"';
    await createPageAs("alice", "team", { title });
    const orm = await mapped(prisma.document.create({ data: { spaceId: ids.spaces.team, title: title.toUpperCase(), createdById: ids.users.alice } }));
    const raw = await mapped(prisma.$executeRaw`
      INSERT INTO "Document" ("id", "spaceId", "title", "createdById") VALUES ('x', ${ids.spaces.team}, ${title.toUpperCase()}, ${ids.users.alice})`);
    expect(orm).toBeInstanceOf(TitleTakenError);
    expect(raw).toBeInstanceOf(TitleTakenError);
  });
});
