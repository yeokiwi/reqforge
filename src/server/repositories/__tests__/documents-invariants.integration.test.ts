// Every invariant of the documents migration, attacked through the LOWEST paths: the Prisma
// ORM and raw SQL ($executeRaw), bypassing the repositories. If one of these passes an attack,
// the rule depends on application code — which is exactly what invariant D2 says it must not.
// spec: docs/specs/01-domain-model.md (Document, DocumentVersion, invariants D1/D2); RD-056, RD-058
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createPageAs, demoIds, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

const PATHS = ["prisma", "raw"] as const;
type Path = (typeof PATHS)[number];

const UNIQUE_TITLE = /lower\(.*title|Document_live_spaceId_title_key/;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let ids: DemoIds;
beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

let rawCounter = 0;
const rawId = () => `raw-${++rawCounter}`;

/** Inserts a bare page row (no version) through the given path. */
function insertPage(path: Path, data: { title: string; spaceId?: string; parentId?: string | null; id?: string }) {
  const spaceId = data.spaceId ?? ids.spaces.team;
  const id = data.id ?? rawId();
  if (path === "prisma") {
    return prisma.document.create({
      data: { id, spaceId, title: data.title, parentId: data.parentId ?? null, createdById: ids.users.alice },
    });
  }
  return prisma.$executeRaw`
    INSERT INTO "Document" ("id", "spaceId", "title", "parentId", "createdById")
    VALUES (${id}, ${spaceId}, ${data.title}, ${data.parentId ?? null}, ${ids.users.alice})`;
}

function updatePage(path: Path, id: string, set: { title?: string; parentId?: string | null; spaceId?: string; ordinal?: number }) {
  if (path === "prisma") return prisma.document.update({ where: { id }, data: set });
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(set)) {
    values.push(v);
    parts.push(`"${k}" = $${values.length}`);
  }
  values.push(id);
  return prisma.$executeRawUnsafe(`UPDATE "Document" SET ${parts.join(", ")} WHERE "id" = $${values.length}`, ...values);
}

describe("Document.title — unique per space among live pages, case-insensitively (RD-056)", () => {
  it.each(PATHS)("%s: a second live page whose title differs only in case is refused", async (path) => {
    await createPageAs("alice", "team", { title: "Release Plan" });
    await expect(insertPage(path, { title: "rELEASE pLAN" })).rejects.toThrow(UNIQUE_TITLE);
  });

  it.each(PATHS)("%s: renaming onto a live title in another case is refused", async (path) => {
    await createPageAs("alice", "team", { title: "Alpha" });
    const b = await createPageAs("alice", "team", { title: "Beta" });
    await expect(updatePage(path, b.id, { title: "ALPHA" })).rejects.toThrow(UNIQUE_TITLE);
  });

  it.each(PATHS)("%s: case-insensitivity covers non-ASCII letters, whatever the database locale", async (path) => {
    await createPageAs("alice", "team", { title: "Äpfel Éclair Ωmega" });
    await expect(insertPage(path, { title: "äpfel éclair ωMEGA" })).rejects.toThrow(UNIQUE_TITLE);
  });

  it.each(PATHS)("%s: a soft-deleted page's title is free again", async (path) => {
    const a = await createPageAs("alice", "team", { title: "Gone" });
    await prisma.document.update({ where: { id: a.id }, data: { deletedAt: new Date(), deletedRootId: a.id } });
    await insertPage(path, { title: "GONE" });
    expect(await prisma.document.count({ where: { spaceId: ids.spaces.team, title: { equals: "gone", mode: "insensitive" } } })).toBe(2);
  });

  it.each(PATHS)("%s: the same title in two spaces is allowed", async (path) => {
    await createPageAs("alice", "team", { title: "Overview" });
    await insertPage(path, { title: "Overview", spaceId: ids.spaces.plat });
  });

  it.each(PATHS)("%s: a blank or over-long title is refused; 255 characters is accepted", async (path) => {
    await expect(insertPage(path, { title: "   " })).rejects.toThrow(/Document_title_length/);
    await expect(insertPage(path, { title: "" })).rejects.toThrow(/Document_title_length/);
    await expect(insertPage(path, { title: "x".repeat(256) })).rejects.toThrow(/Document_title_length/);
    await insertPage(path, { title: "y".repeat(255) });
  });
});

describe("Document tree — same space, no cycles (trigger document_tree_guard)", () => {
  it.each(PATHS)("%s: a page cannot be its own parent (update)", async (path) => {
    const a = await createPageAs("alice", "team");
    await expect(updatePage(path, a.id, { parentId: a.id })).rejects.toThrow(/own parent/);
  });

  it.each(PATHS)("%s: a page cannot be inserted as its own parent", async (path) => {
    await expect(insertPage(path, { id: "self", title: "Self", parentId: "self" })).rejects.toThrow(/own parent/);
  });

  it.each(PATHS)("%s: a page cannot be moved under its own descendant", async (path) => {
    const a = await createPageAs("alice", "team", { title: "A" });
    const b = await createPageAs("alice", "team", { title: "B", parentId: a.id });
    const c = await createPageAs("alice", "team", { title: "C", parentId: b.id });
    await expect(updatePage(path, a.id, { parentId: c.id })).rejects.toThrow(/own descendant/);
    await expect(updatePage(path, a.id, { parentId: b.id })).rejects.toThrow(/own descendant/);
  });

  it.each(PATHS)("%s: a parent in another space is refused, on insert and on update", async (path) => {
    const plat = await createPageAs("alice", "plat");
    const team = await createPageAs("alice", "team");
    await expect(insertPage(path, { title: "Child", parentId: plat.id })).rejects.toThrow(/same space/);
    await expect(updatePage(path, team.id, { parentId: plat.id })).rejects.toThrow(/same space/);
  });

  it.each(PATHS)("%s: a page with children cannot change space (its children would be left behind)", async (path) => {
    const parent = await createPageAs("alice", "team", { title: "Parent" });
    await createPageAs("alice", "team", { title: "Child", parentId: parent.id });
    await expect(updatePage(path, parent.id, { spaceId: ids.spaces.plat })).rejects.toThrow(/document_tree_guard/);
    const child = await prisma.document.findFirstOrThrow({ where: { parentId: parent.id } });
    const parentNow = await prisma.document.findUniqueOrThrow({ where: { id: parent.id } });
    expect(parentNow.spaceId).toBe(child.spaceId);
  });

  it.each(PATHS)("%s: a leaf page changing space must also leave its parent", async (path) => {
    const parent = await createPageAs("alice", "team", { title: "Parent" });
    const child = await createPageAs("alice", "team", { title: "Child", parentId: parent.id });
    await expect(updatePage(path, child.id, { spaceId: ids.spaces.plat })).rejects.toThrow(/same space/);
  });

  it.each(PATHS)("%s: ordinals cannot be negative", async (path) => {
    const a = await createPageAs("alice", "team");
    await expect(updatePage(path, a.id, { ordinal: -1 })).rejects.toThrow(/Document_ordinal_nonnegative/);
  });

  it.each(PATHS)("%s: deletedAt and deletedRootId are set together", async (path) => {
    const a = await createPageAs("alice", "team");
    const attempt =
      path === "prisma"
        ? prisma.document.update({ where: { id: a.id }, data: { deletedAt: new Date() } })
        : prisma.$executeRaw`UPDATE "Document" SET "deletedRootId" = ${a.id} WHERE "id" = ${a.id}`;
    await expect(attempt).rejects.toThrow(/Document_deleted_consistent/);
  });
});

describe("Document.currentVersionId — one of the page's own versions, never deletable while current", () => {
  it.each(PATHS)("%s: pointing a page at another page's version is refused", async (path) => {
    const a = await createPageAs("alice", "team");
    const b = await createPageAs("alice", "team");
    const foreign = b.versions[0]!.id;
    const attempt =
      path === "prisma"
        ? prisma.document.update({ where: { id: a.id }, data: { currentVersionId: foreign } })
        : prisma.$executeRaw`UPDATE "Document" SET "currentVersionId" = ${foreign} WHERE "id" = ${a.id}`;
    await expect(attempt).rejects.toThrow(/document_current_version_guard/);
  });

  it.each(PATHS)("%s: deleting the current version is refused (ON DELETE RESTRICT)", async (path) => {
    const a = await createPageAs("alice", "team", { versions: 2 });
    const current = a.versions[1]!.id;
    const attempt =
      path === "prisma"
        ? prisma.documentVersion.delete({ where: { id: current } })
        : prisma.$executeRaw`DELETE FROM "DocumentVersion" WHERE "id" = ${current}`;
    await expect(attempt).rejects.toThrow(/Document_currentVersionId_fkey/);
    expect(await prisma.documentVersion.count({ where: { id: current } })).toBe(1);
  });
});

describe("DocumentVersion is immutable except `pinned` — invariant D2", () => {
  const rewrites: Record<string, (ctx: { other: string }) => Record<string, unknown>> = {
    content: () => ({ content: { type: "doc", content: [] } }),
    title: () => ({ title: "Rewritten" }),
    number: () => ({ number: 99 }),
    authorId: ({ other }) => ({ authorId: other }),
    message: () => ({ message: "rewritten" }),
    createdAt: () => ({ createdAt: new Date("2000-01-01T00:00:00Z") }),
  };

  for (const [field, make] of Object.entries(rewrites)) {
    it.each(PATHS)(`%s: rewriting ${field} is refused`, async (path) => {
      const a = await createPageAs("alice", "team", { versions: 2 });
      const v1 = a.versions[0]!;
      const set = make({ other: ids.users.bob });
      const attempt =
        path === "prisma"
          ? prisma.documentVersion.update({ where: { id: v1.id }, data: set })
          : field === "content"
            ? prisma.$executeRaw`UPDATE "DocumentVersion" SET "content" = '{"type":"doc","content":[]}'::jsonb WHERE "id" = ${v1.id}`
            : prisma.$executeRawUnsafe(`UPDATE "DocumentVersion" SET "${field}" = $1 WHERE "id" = $2`, Object.values(set)[0], v1.id);
      await expect(attempt).rejects.toThrow(/is immutable: only \\*"pinned\\*" may change/);
      const after = await prisma.documentVersion.findUniqueOrThrow({ where: { id: v1.id } });
      expect(after.title).toBe(v1.title);
      expect(after.number).toBe(1);
    });
  }

  it.each(PATHS)("%s: moving a version to another page is refused", async (path) => {
    const a = await createPageAs("alice", "team", { versions: 2 });
    const b = await createPageAs("alice", "team");
    const attempt =
      path === "prisma"
        ? prisma.documentVersion.update({ where: { id: a.versions[0]!.id }, data: { documentId: b.id } })
        : prisma.$executeRaw`UPDATE "DocumentVersion" SET "documentId" = ${b.id} WHERE "id" = ${a.versions[0]!.id}`;
    await expect(attempt).rejects.toThrow(/is immutable/);
  });

  it.each(PATHS)("%s: `pinned` may change; a pinned version cannot then be deleted", async (path) => {
    const a = await createPageAs("alice", "team", { versions: 2 });
    const v1 = a.versions[0]!.id;
    if (path === "prisma") await prisma.documentVersion.update({ where: { id: v1 }, data: { pinned: true } });
    else await prisma.$executeRaw`UPDATE "DocumentVersion" SET "pinned" = true WHERE "id" = ${v1}`;
    const attempt =
      path === "prisma"
        ? prisma.documentVersion.delete({ where: { id: v1 } })
        : prisma.$executeRaw`DELETE FROM "DocumentVersion" WHERE "id" = ${v1}`;
    await expect(attempt).rejects.toThrow(/pinned by a baseline/);
    // Unpinning (a baseline was deleted) makes it deletable again.
    await prisma.$executeRaw`UPDATE "DocumentVersion" SET "pinned" = false WHERE "id" = ${v1}`;
    await prisma.$executeRaw`DELETE FROM "DocumentVersion" WHERE "id" = ${v1}`;
  });

  it.each(PATHS)("%s: hard-deleting a page with a pinned version is refused (the cascade hits the trigger)", async (path) => {
    const a = await createPageAs("alice", "team", { versions: 3 });
    await prisma.documentVersion.update({ where: { id: a.versions[0]!.id }, data: { pinned: true } });
    const attempt =
      path === "prisma"
        ? prisma.document.delete({ where: { id: a.id } })
        : prisma.$executeRaw`DELETE FROM "Document" WHERE "id" = ${a.id}`;
    await expect(attempt).rejects.toThrow(/pinned by a baseline/);
    expect(await prisma.documentVersion.count({ where: { documentId: a.id } })).toBe(3);
    expect(await prisma.document.count({ where: { id: a.id } })).toBe(1);
  });

  it.each(PATHS)("%s: hard-deleting a page without pinned versions cascades (control for the test above)", async (path) => {
    const a = await createPageAs("alice", "team", { versions: 3 });
    if (path === "prisma") await prisma.document.delete({ where: { id: a.id } });
    else await prisma.$executeRaw`DELETE FROM "Document" WHERE "id" = ${a.id}`;
    expect(await prisma.documentVersion.count({ where: { documentId: a.id } })).toBe(0);
  });

  it.each(PATHS)("%s: a version needs a positive number, a 1–255 title and a note of at most 500", async (path) => {
    const a = await createPageAs("alice", "team");
    const insert = (number: number, title: string, message: string | null) =>
      path === "prisma"
        ? prisma.documentVersion.create({ data: { documentId: a.id, number, title, content: {}, authorId: ids.users.alice, message } })
        : prisma.$executeRaw`
            INSERT INTO "DocumentVersion" ("id", "documentId", "number", "title", "content", "authorId", "message")
            VALUES (${rawId()}, ${a.id}, ${number}, ${title}, '{}'::jsonb, ${ids.users.alice}, ${message})`;
    await expect(insert(0, "T", null)).rejects.toThrow(/DocumentVersion_number_positive/);
    await expect(insert(5, " ", null)).rejects.toThrow(/DocumentVersion_title_length/);
    await expect(insert(5, "T", "m".repeat(501))).rejects.toThrow(/DocumentVersion_message_length/);
    await expect(insert(1, "T", null)).rejects.toThrow(/Unique constraint|23505|already exists/);
    await insert(5, "T", "m".repeat(500));
  });
});

describe("Attachment — bounded, content-addressed, immutable except deletedAt (RD-058)", () => {
  async function page() {
    return createPageAs("alice", "team");
  }

  function insertAttachment(
    path: Path,
    documentId: string,
    a: { data: Uint8Array; size?: number; sha256?: string; filename?: string; contentType?: string },
  ) {
    const size = a.size ?? a.data.byteLength;
    const sha256 = a.sha256 ?? sha(a.data);
    const filename = a.filename ?? "f.png";
    const contentType = a.contentType ?? "image/png";
    if (path === "prisma") {
      return prisma.attachment.create({
        data: { documentId, filename, contentType, size, sha256, data: new Uint8Array(a.data), uploadedById: ids.users.alice },
      });
    }
    return prisma.$executeRaw`
      INSERT INTO "Attachment" ("id", "documentId", "filename", "contentType", "size", "sha256", "data", "uploadedById")
      VALUES (${rawId()}, ${documentId}, ${filename}, ${contentType}, ${size}, ${sha256}, ${Buffer.from(a.data)}, ${ids.users.alice})`;
  }

  it.each(PATHS)("%s: the declared size must equal the bytes", async (path) => {
    const p = await page();
    await expect(insertAttachment(path, p.id, { data: new Uint8Array([1, 2, 3]), size: 4 })).rejects.toThrow(/Attachment_size_matches/);
  });

  it.each(PATHS)("%s: an empty attachment is refused", async (path) => {
    const p = await page();
    await expect(insertAttachment(path, p.id, { data: new Uint8Array(0) })).rejects.toThrow(/Attachment_size_matches/);
  });

  it.each(PATHS)("%s: the hash must be 64 lower-case hex digits", async (path) => {
    const p = await page();
    const data = new Uint8Array([1, 2, 3]);
    await expect(insertAttachment(path, p.id, { data, sha256: sha(data).toUpperCase() })).rejects.toThrow(/Attachment_sha256/);
    await expect(insertAttachment(path, p.id, { data, sha256: "abc" })).rejects.toThrow(/Attachment_sha256/);
  });

  it.each(PATHS)("%s: the hash must be the SHA-256 of the bytes — content addressing cannot lie", async (path) => {
    const p = await page();
    await expect(
      insertAttachment(path, p.id, { data: new Uint8Array([1, 2, 3]), sha256: sha(new Uint8Array([9])) }),
    ).rejects.toThrow(/Attachment_sha256_matches/);
  });

  it.each(PATHS)("%s: filename and content type lengths are bounded", async (path) => {
    const p = await page();
    const data = new Uint8Array([1]);
    await expect(insertAttachment(path, p.id, { data, filename: "" })).rejects.toThrow(/Attachment_filename_length/);
    await expect(insertAttachment(path, p.id, { data, contentType: "x" })).rejects.toThrow(/Attachment_content_type_length/);
  });

  it("raw: 10 MiB is accepted and 10 MiB + 1 byte refused (bytes generated in the database)", async () => {
    const p = await page();
    const insertN = (n: number) => prisma.$executeRaw`
      WITH b AS (SELECT decode(repeat('ab', ${n}::int), 'hex') AS data)
      INSERT INTO "Attachment" ("id", "documentId", "filename", "contentType", "size", "sha256", "data", "uploadedById")
      SELECT ${rawId()}, ${p.id}, 'big.bin', 'application/octet-stream', ${n}::int, encode(sha256(b.data), 'hex'), b.data, ${ids.users.alice} FROM b`;
    await insertN(10_485_760);
    await expect(insertN(10_485_761)).rejects.toThrow(/Attachment_size_matches/);
  });

  it("prisma: 10 MiB + 1 byte is refused", async () => {
    const p = await page();
    await expect(insertAttachment("prisma", p.id, { data: new Uint8Array(10_485_761) })).rejects.toThrow(/Attachment_size_matches/);
  });

  const rewrites: Record<string, (ctx: { otherPage: string }) => Record<string, unknown>> = {
    data: () => ({ data: new Uint8Array([7, 7, 7]) }),
    filename: () => ({ filename: "renamed.png" }),
    contentType: () => ({ contentType: "image/gif" }),
    size: () => ({ size: 2 }),
    sha256: () => ({ sha256: "0".repeat(64) }),
    documentId: ({ otherPage }) => ({ documentId: otherPage }),
    createdAt: () => ({ createdAt: new Date("2000-01-01T00:00:00Z") }),
  };
  for (const [field, make] of Object.entries(rewrites)) {
    it.each(PATHS)(`%s: rewriting ${field} is refused`, async (path) => {
      const p = await page();
      const other = await page();
      const att = await prisma.attachment.create({
        data: { documentId: p.id, filename: "a.png", contentType: "image/png", size: 3, sha256: sha(new Uint8Array([1, 2, 3])), data: new Uint8Array([1, 2, 3]), uploadedById: ids.users.alice },
      });
      const set = make({ otherPage: other.id });
      const value = Object.values(set)[0];
      const attempt =
        path === "prisma"
          ? prisma.attachment.update({ where: { id: att.id }, data: set })
          : prisma.$executeRawUnsafe(
              `UPDATE "Attachment" SET "${field}" = $1 WHERE "id" = $2`,
              value instanceof Uint8Array ? Buffer.from(value) : value,
              att.id,
            );
      await expect(attempt).rejects.toThrow(/is immutable: only \\*"deletedAt\\*" may change/);
      const after = await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } });
      expect([...after.data]).toEqual([1, 2, 3]);
    });
  }

  it.each(PATHS)("%s: hiding (deletedAt) is allowed, and so is un-hiding; the bytes stay", async (path) => {
    const p = await page();
    const att = await prisma.attachment.create({
      data: { documentId: p.id, filename: "a.png", contentType: "image/png", size: 1, sha256: sha(new Uint8Array([5])), data: new Uint8Array([5]), uploadedById: ids.users.alice },
    });
    const at = new Date("2026-10-09T10:00:00.000Z");
    if (path === "prisma") await prisma.attachment.update({ where: { id: att.id }, data: { deletedAt: at } });
    else await prisma.$executeRaw`UPDATE "Attachment" SET "deletedAt" = ${at} WHERE "id" = ${att.id}`;
    const hidden = await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(hidden.deletedAt?.toISOString()).toBe(at.toISOString());
    expect([...hidden.data]).toEqual([5]);
    await prisma.$executeRaw`UPDATE "Attachment" SET "deletedAt" = NULL WHERE "id" = ${att.id}`;
  });
});

describe("DocumentDraft", () => {
  it.each(PATHS)("%s: base version must be positive and the title at most 255", async (path) => {
    const p = await createPageAs("alice", "team");
    const insert = (base: number, title: string) =>
      path === "prisma"
        ? prisma.documentDraft.create({ data: { documentId: p.id, userId: ids.users.alice, title, content: {}, baseVersionNumber: base } })
        : prisma.$executeRaw`
            INSERT INTO "DocumentDraft" ("documentId", "userId", "title", "content", "baseVersionNumber", "updatedAt")
            VALUES (${p.id}, ${ids.users.alice}, ${title}, '{}'::jsonb, ${base}, now())`;
    await expect(insert(0, "T")).rejects.toThrow(/DocumentDraft_base_positive/);
    await expect(insert(1, "x".repeat(256))).rejects.toThrow(/DocumentDraft_title_length/);
    await insert(1, ""); // an empty title is allowed while editing
  });
});
