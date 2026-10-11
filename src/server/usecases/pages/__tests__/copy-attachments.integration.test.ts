// copyPage (with images) and the attachment use cases.
// spec: 08 §3 (copy, attachments, attachment bytes), §3.2; RD-056 (copy), RD-058, RD-070, RD-071
import { beforeEach, describe, expect, it } from "vitest";
import { attachmentUrl } from "@/domain/documents";
import { ForbiddenError, NotFoundError, TitleTakenError, TooLargeError, UnsupportedMediaError, ValidationError } from "@/domain/errors";
import { sha256Hex } from "@/server/repositories/attachments";
import { softDeleteSubtree } from "@/server/repositories/documents";
import { lockTree, transaction } from "@/server/repositories/transaction";
import {
  COPY_ATTACHMENT_BYTES_MAX,
  copyPage,
  createPage,
  deletePage,
  getEditorState,
  getPageView,
  hideAttachment,
  listAttachments,
  listPageTree,
  publishPage,
  readAttachment,
  uploadAttachment,
} from "@/server/usecases/pages";
import { buildTree, createPageAs, demoIds, paragraphDoc } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";
import { imageAttachmentIds } from "../copy-content";
import {
  PLAT,
  TEAM,
  actors,
  auditRows,
  canonical,
  expectError,
  imageDoc,
  pngBytes,
  untilSomeoneWaitsForALock,
  uploadPng,
  versionNumbers,
  type Actors,
} from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

describe("copyPage", () => {
  it("copies one page as `Copy of <title>`, under the same parent, at the end, watched by the copier", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Parent", children: [{ title: "Spec", children: [{ title: "Child" }] }, { title: "Sibling" }] }]);
    const copy = await copyPage(who.bob, TEAM, ids.Spec as string);
    expect(copy).toMatchObject({
      title: "Copy of Spec",
      parentId: ids.Parent,
      ordinal: 2,
      currentVersion: 1,
      descendantCount: 0,
      watching: true,
      createdBy: { id: who.bob.id },
    });
    const view = await getPageView(who.bob, TEAM, copy.id);
    // The copy holds the source's content in canonical form (RD-063), not the fixture's raw JSON.
    expect(view.version.content).toEqual(canonical(paragraphDoc("Spec v1")));
    expect(view.version.message).toBeNull();
    // The page only, not its descendants.
    expect((await listPageTree(who.bob, TEAM)).pages).toHaveLength(5);
    const audit = (await auditRows(copy.id)).find((r) => r.operation === "page.copy");
    expect(audit?.parameters).toMatchObject({ sourceId: ids.Spec, sourceVersion: 1, title: "Copy of Spec", parentId: ids.Parent, attachments: [] });
  });

  it("makes the made-up title unique, and honours an explicit one", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    expect((await copyPage(who.alice, TEAM, page.id)).title).toBe("Copy of Spec");
    expect((await copyPage(who.alice, TEAM, page.id)).title).toBe("Copy of Spec 2");
    expect((await copyPage(who.alice, TEAM, page.id, { title: " Mine " })).title).toBe("Mine");
    await expectError(copyPage(who.alice, TEAM, page.id, { title: "spec" }), TitleTakenError);
    await expectError(copyPage(who.alice, TEAM, page.id, { title: "" }), ValidationError);
  });

  it("duplicates every attachment an image references (live or hidden), re-points the images, and stays publishable", async () => {
    const source = await createPage(who.alice, TEAM, { title: "Spec" });
    const live = await uploadPng(who.alice, TEAM, source.id, "live diagram é.png");
    const hidden = await uploadPng(who.alice, TEAM, source.id, "old.png");
    const unreferenced = await uploadAttachment(who.alice, TEAM, source.id, { filename: "notes.txt", bytes: new TextEncoder().encode("notes") });
    await publishPage(who.alice, TEAM, source.id, { title: "Spec", content: imageDoc(live, hidden), baseVersion: 1 });
    await hideAttachment(who.alice, TEAM, source.id, hidden.id);

    const copy = await copyPage(who.bob, TEAM, source.id);

    const rows = await prisma.attachment.findMany({ where: { documentId: copy.id }, orderBy: { filename: "asc" } });
    expect(rows.map((r) => [r.filename, r.deletedAt === null, r.uploadedById])).toEqual([
      ["live diagram é.png", true, who.bob.id],
      ["old.png", false, who.bob.id],
    ]);
    const original = await prisma.attachment.findMany({ where: { id: { in: [live.id, hidden.id] } } });
    expect(new Set(rows.map((r) => r.sha256))).toEqual(new Set(original.map((r) => r.sha256)));
    expect(rows.map((r) => r.id)).not.toContain(live.id);
    expect(rows.map((r) => r.filename)).not.toContain(unreferenced.filename);

    const copied = (await getPageView(who.bob, TEAM, copy.id)).version.content;
    const byName = new Map(rows.map((r) => [r.filename, r.id]));
    expect(imageAttachmentIds(copied)).toEqual(new Set(rows.map((r) => r.id)));
    expect(JSON.stringify(copied)).toContain(JSON.stringify(attachmentUrl(byName.get("live diagram é.png") as string, "live diagram é.png")));
    expect(JSON.stringify(copied)).not.toContain(live.id);

    // The copy lists only its live attachment, serves both, and can be published as it stands.
    expect((await listAttachments(who.bob, TEAM, copy.id)).map((a) => a.filename)).toEqual(["live diagram é.png"]);
    for (const row of rows) expect((await readAttachment(who.carol, row.id)).sha256).toBe(row.sha256);
    const state = await getEditorState(who.bob, TEAM, copy.id);
    const republished = await publishPage(who.bob, TEAM, copy.id, { ...state.initial, baseVersion: state.initial.baseVersion });
    expect(republished.version.number).toBe(2);

    // The source is untouched.
    expect(await versionNumbers(source.id)).toEqual([1, 2]);
    expect(await prisma.attachment.count({ where: { documentId: source.id } })).toBe(3);
    const audit = (await auditRows(copy.id)).find((r) => r.operation === "page.copy");
    expect((audit?.parameters as { attachments: unknown[] }).attachments).toHaveLength(2);
  });

  it("needs EDIT, and is NotFound for a page of another space addressed through this one", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(copyPage(who.carol, TEAM, page.id), ForbiddenError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(copyPage(who.bob, TEAM, plat.id), NotFoundError);
    await expectError(copyPage(who.bob, PLAT, plat.id), ForbiddenError);
    expect(await prisma.document.count()).toBe(2);
  });
});

describe("copyPage's cost is bounded (07 §5: it runs in the request, holding the space's tree lock)", () => {
  const MIB = 1024 * 1024;
  /** A 10 MiB PNG; `n` makes each one's bytes (and hash) different. */
  const bigPng = (n: number) => {
    const bytes = new Uint8Array(10 * MIB);
    bytes.set(pngBytes(), 0);
    bytes[64] = n;
    return bytes;
  };
  const writes = async () => ({
    documents: await prisma.document.count(),
    attachments: await prisma.attachment.count(),
    copies: (await auditRows()).filter((r) => r.operation === "page.copy").length,
  });

  it("refuses a copy whose images carry more than 50 MiB with TOO_LARGE naming the limit, and writes nothing", async () => {
    expect(COPY_ATTACHMENT_BYTES_MAX).toBe(50 * MIB);
    const ids = await demoIds();
    const source = await createPage(who.alice, TEAM, { title: "Spec" });
    const refs = [];
    for (let i = 0; i < 6; i++) refs.push(await uploadAttachment(who.alice, TEAM, source.id, { filename: `big ${i}.png`, bytes: bigPng(i) }));
    await publishPage(who.alice, TEAM, source.id, { title: "Spec", content: imageDoc(...refs), baseVersion: 1 });
    const before = await writes();

    // 60 MiB of live attachments: refused from their sizes alone, before the tree lock — so even
    // with another change holding the lock, the refusal does not wait for it.
    await transaction(async (tx) => {
      expect(await lockTree(tx, ids.spaces.team)).toBe(true);
      expect((await expectError(copyPage(who.bob, TEAM, source.id), TooLargeError)).limit).toBe(COPY_ATTACHMENT_BYTES_MAX);
    });
    expect(await writes()).toEqual(before);

    // Hide one: 50 MiB live, but the copy still carries the hidden one the images show (RD-058).
    // Its size is only known once it is read, so this refusal comes mid-copy — and rolls back.
    await hideAttachment(who.alice, TEAM, source.id, refs[5]?.id as string);
    expect((await expectError(copyPage(who.bob, TEAM, source.id), TooLargeError)).limit).toBe(COPY_ATTACHMENT_BYTES_MAX);
    expect(await writes()).toEqual(before);

    // Exactly at the limit is allowed.
    await publishPage(who.alice, TEAM, source.id, { title: "Spec", content: imageDoc(...refs.slice(0, 5)), baseVersion: 2 });
    const copy = await copyPage(who.bob, TEAM, source.id);
    expect(await prisma.attachment.count({ where: { documentId: copy.id } })).toBe(5);
  }, 120_000);

  it("reads the source under the tree lock: a source deleted while the copy waits for the lock is NotFound, and nothing is written", async () => {
    const ids = await demoIds();
    const source = await createPage(who.alice, TEAM, { title: "Spec" });
    const image = await uploadPng(who.alice, TEAM, source.id);
    await publishPage(who.alice, TEAM, source.id, { title: "Spec", content: imageDoc(image), baseVersion: 1 });
    const plain = await createPage(who.alice, TEAM, { title: "Plain" });

    for (const page of [source, plain]) {
      const before = await writes();
      let copying: Promise<unknown> | undefined;
      await transaction(async (tx) => {
        expect(await lockTree(tx, ids.spaces.team)).toBe(true);
        copying = copyPage(who.bob, TEAM, page.id);
        copying.catch(() => undefined); // awaited below
        await untilSomeoneWaitsForALock();
        await softDeleteSubtree(tx, { documentId: page.id, deletedById: ids.users.alice });
      });
      await expectError(copying ?? Promise.resolve(), NotFoundError);
      expect(await writes()).toEqual(before);
    }
  });
});

describe("uploadAttachment (RD-058, RD-071)", () => {
  it("stores a verified image with a sanitised name and returns its AttachmentRef; audited with the hash", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const bytes = pngBytes(100);
    const ref = await uploadAttachment(who.bob, TEAM, page.id, { filename: "../../dir/my diagram‮.png", declaredContentType: "image/png", bytes });
    expect(ref).toMatchObject({
      filename: "my diagram.png",
      contentType: "image/png",
      size: bytes.byteLength,
      image: true,
      uploadedBy: { id: who.bob.id, name: who.bob.name },
    });
    expect(ref.url).toBe(`/api/v1/attachments/${ref.id}/my%20diagram.png`);
    expect(ref.url).toBe(attachmentUrl(ref.id, ref.filename));
    const audit = (await auditRows(ref.id)).find((r) => r.operation === "attachment.upload");
    expect(audit).toMatchObject({ actorId: who.bob.id, objectType: "attachment" });
    expect(audit?.parameters).toMatchObject({ pageId: page.id, filename: "my diagram.png", contentType: "image/png", sha256: sha256Hex(bytes) });
  });

  it("treats a file declared image/png that is not a PNG as a plain download", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const ref = await uploadAttachment(who.alice, TEAM, page.id, {
      filename: "fake.png",
      declaredContentType: "image/png",
      bytes: new TextEncoder().encode("<html><script>alert(1)</script></html>"),
    });
    expect(ref).toMatchObject({ contentType: "application/octet-stream", image: false });
    expect(await readAttachment(who.carol, ref.id)).toMatchObject({ kind: "file", contentType: "application/octet-stream" });
  });

  it.each([
    ["a declared SVG type", { filename: "a.png", declaredContentType: "image/svg+xml", bytes: pngBytes() }],
    ["an .svg name", { filename: "logo.svg", declaredContentType: null, bytes: pngBytes() }],
    ["SVG bytes behind a PNG name and type", { filename: "x.png", declaredContentType: "image/png", bytes: new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>') }],
  ])("refuses SVG (%s) with UNSUPPORTED_MEDIA and stores nothing", async (_label, upload) => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(uploadAttachment(who.alice, TEAM, page.id, upload), UnsupportedMediaError);
    expect(await prisma.attachment.count()).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it("refuses an empty file (VALIDATION at file) and one over 10 MiB (TOO_LARGE with the limit)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const empty = await expectError(uploadAttachment(who.alice, TEAM, page.id, { filename: "e.txt", bytes: new Uint8Array(0) }), ValidationError);
    expect(empty.errors.map((e) => e.path)).toEqual(["file"]);
    const big = await expectError(
      uploadAttachment(who.alice, TEAM, page.id, { filename: "big.bin", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }),
      TooLargeError,
    );
    expect(big.limit).toBe(10_485_760);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("needs EDIT and a live page of this space", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectError(uploadPng(who.carol, TEAM, page.id), ForbiddenError);
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(uploadPng(who.bob, PLAT, plat.id), ForbiddenError);
    await expectError(uploadPng(who.alice, TEAM, plat.id), NotFoundError);
    await deletePage(who.alice, TEAM, page.id);
    await expectError(uploadPng(who.alice, TEAM, page.id), NotFoundError);
    expect(await prisma.attachment.count()).toBe(0);
  });
});

describe("listAttachments, hideAttachment, readAttachment", () => {
  it("lists live attachments newest first; hiding is idempotent and audited once; hidden bytes are still served", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const first = await uploadPng(who.alice, TEAM, page.id, "first.png");
    const second = await uploadPng(who.alice, TEAM, page.id, "second.png");
    expect((await listAttachments(who.carol, TEAM, page.id)).map((a) => a.id)).toEqual([second.id, first.id]);

    await hideAttachment(who.bob, TEAM, page.id, first.id);
    await hideAttachment(who.bob, TEAM, page.id, first.id);
    expect((await listAttachments(who.carol, TEAM, page.id)).map((a) => a.id)).toEqual([second.id]);
    expect((await auditRows(first.id)).filter((r) => r.operation === "attachment.delete")).toHaveLength(1);

    const served = await readAttachment(who.carol, first.id);
    expect(served).toMatchObject({ id: first.id, filename: "first.png", kind: "image", contentType: "image/png" });
    expect(Buffer.from(served.data).equals(Buffer.from(pngBytes()))).toBe(true);
  });

  it("hide is NotFound for an unknown attachment or one of another page, and needs EDIT", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const other = await createPageAs("alice", "team", { title: "Other" });
    const att = await uploadPng(who.alice, TEAM, other.id);
    await expectError(hideAttachment(who.alice, TEAM, page.id, att.id), NotFoundError);
    await expectError(hideAttachment(who.alice, TEAM, page.id, "nope"), NotFoundError);
    await expectError(hideAttachment(who.carol, TEAM, other.id, att.id), ForbiddenError);
    expect((await listAttachments(who.alice, TEAM, other.id)).map((a) => a.id)).toEqual([att.id]);
  });

  it("read is NotFound when the caller cannot view the page's space, the page is deleted, or the id is malformed", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    const att = await uploadPng(who.alice, PLAT, plat.id);
    await expect(readAttachment(who.bob, att.id)).resolves.toMatchObject({ id: att.id });
    await expectError(readAttachment(who.carol, att.id), NotFoundError);
    await deletePage(who.alice, PLAT, plat.id);
    await expectError(readAttachment(who.alice, att.id), NotFoundError);
    await expectError(readAttachment(who.alice, "../x"), NotFoundError);
  });

  it("list needs VIEW", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(listAttachments(who.carol, PLAT, plat.id), NotFoundError);
    await expect(listAttachments(who.bob, PLAT, plat.id)).resolves.toEqual([]);
  });
});
