// Attachments through the REST API (spec 08 §3; RD-058, RD-070, RD-071): upload, list, hide, and
// the bytes route with its headers — verified image types inline, everything else a nosniff
// octet-stream download, a sandboxing CSP, a private cache, an ETag, and a 304 that is only ever
// given after the visibility check.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { AttachmentRef } from "@/domain/documents";
import { createPageAs } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance, type Handle } from "@/test-support/fixtures";
import { expectProblem, readJson, routeContext, send, sessionFor, streamOf, uploadRequest } from "@/test-support/api-harness";
import * as listRoute from "../spaces/[spaceKey]/pages/[id]/attachments/route";
import * as hideRoute from "../spaces/[spaceKey]/pages/[id]/attachments/[attachmentId]/route";
import * as bytesRoute from "../attachments/[attachmentId]/[filename]/route";

let session: Record<Handle, string>;
beforeEach(async () => {
  await resetDemoInstance();
  session = { alice: await sessionFor("alice"), bob: await sessionFor("bob"), carol: await sessionFor("carol") };
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const attachmentsUrl = (key: string, id: string) => `/api/v1/spaces/${key}/pages/${id}/attachments`;

async function upload(handle: Handle, key: string, pageId: string, file: { name: string; type?: string; bytes: Uint8Array }): Promise<Response> {
  const req = uploadRequest(attachmentsUrl(key, pageId), file, { session: session[handle] });
  return listRoute.POST(req, routeContext({ spaceKey: key, id: pageId }));
}

function getBytes(handle: Handle | null, ref: { id: string }, filename = "anything.png", headers: Record<string, string> = {}): Promise<Response> {
  return send(bytesRoute.GET, "GET", `/api/v1/attachments/${ref.id}/${encodeURIComponent(filename)}`, { attachmentId: ref.id, filename }, {
    session: handle === null ? null : session[handle],
    headers,
  });
}

describe("POST /pages/{id}/attachments", () => {
  it("stores an upload: 201 AttachmentRef with a sanitised name and a percent-encoded url", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const res = await upload("bob", "TEAM", page.id, { name: "../my diagram.png", type: "image/png", bytes: PNG });
    expect(res.status).toBe(201);
    const ref = await readJson<AttachmentRef>(res);
    expect(ref).toMatchObject({ filename: "my diagram.png", contentType: "image/png", size: PNG.byteLength, image: true, uploadedBy: { name: "Bob Editor" } });
    expect(ref.url).toBe(`/api/v1/attachments/${ref.id}/my%20diagram.png`);
  });

  it("refuses SVG with 415, an empty file with 422 at file, a JSON body with 415, a viewer with 403", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectProblem(await upload("bob", "TEAM", page.id, { name: "x.svg", type: "image/svg+xml", bytes: new TextEncoder().encode("<svg/>") }), 415, "UNSUPPORTED_MEDIA");
    await expectProblem(
      await upload("bob", "TEAM", page.id, { name: "x.png", type: "image/png", bytes: new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>') }),
      415,
      "UNSUPPORTED_MEDIA",
    );
    const empty = await expectProblem(await upload("bob", "TEAM", page.id, { name: "e.txt", bytes: new Uint8Array(0) }), 422, "VALIDATION");
    expect(empty.errors?.map((e) => e.path)).toEqual(["file"]);
    await expectProblem(
      await send(listRoute.POST, "POST", attachmentsUrl("TEAM", page.id), { spaceKey: "TEAM", id: page.id }, { session: session.bob, json: { file: "x" } }),
      415,
      "UNSUPPORTED_MEDIA",
    );
    await expectProblem(await upload("carol", "TEAM", page.id, { name: "x.png", bytes: PNG }), 403, "FORBIDDEN");
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("refuses an upload body over 10 MiB + framing with 413 and the 10 MiB limit, streamed, with no Content-Length", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const res = await send(listRoute.POST, "POST", attachmentsUrl("TEAM", page.id), { spaceKey: "TEAM", id: page.id }, {
      session: session.bob,
      body: streamOf(64 * 1024 * 1024),
      contentType: "multipart/form-data; boundary=----x",
    });
    expect((await expectProblem(res, 413, "TOO_LARGE")).limit).toBe(10_485_760);
  });

  it("refuses a file just over 10 MiB inside a body that fits the framing cap with 413", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const res = await upload("bob", "TEAM", page.id, { name: "big.bin", bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect((await expectProblem(res, 413, "TOO_LARGE")).limit).toBe(10_485_760);
  });
});

describe("GET and DELETE /pages/{id}/attachments", () => {
  it("lists live attachments newest first; hiding is an idempotent 204", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const a = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "a.png", bytes: PNG }));
    const b = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "b.txt", bytes: new TextEncoder().encode("b") }));
    const list = async () =>
      readJson<AttachmentRef[]>(await send(listRoute.GET, "GET", attachmentsUrl("TEAM", page.id), { spaceKey: "TEAM", id: page.id }, { session: session.carol }));
    expect((await list()).map((x) => x.id)).toEqual([b.id, a.id]);
    for (let i = 0; i < 2; i++) {
      const res = await send(hideRoute.DELETE, "DELETE", `${attachmentsUrl("TEAM", page.id)}/${a.id}`, { spaceKey: "TEAM", id: page.id, attachmentId: a.id }, { session: session.bob });
      expect(res.status).toBe(204);
    }
    expect((await list()).map((x) => x.id)).toEqual([b.id]);
    await expectProblem(
      await send(hideRoute.DELETE, "DELETE", `${attachmentsUrl("TEAM", page.id)}/nope`, { spaceKey: "TEAM", id: page.id, attachmentId: "nope" }, { session: session.bob }),
      404,
      "NOT_FOUND",
    );
    await expectProblem(
      await send(hideRoute.DELETE, "DELETE", `${attachmentsUrl("TEAM", page.id)}/${b.id}`, { spaceKey: "TEAM", id: page.id, attachmentId: b.id }, { session: session.carol }),
      403,
      "FORBIDDEN",
    );
  });
});

describe("GET /api/v1/attachments/{attachmentId}/{filename}", () => {
  it("serves a verified image inline with its type, nosniff, a sandboxing CSP, a private cache and an ETag", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const ref = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "diagram é.png", type: "image/png", bytes: PNG }));
    const res = await getBytes("carol", ref, "diagram é.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="diagram e.png"; filename*=UTF-8''diagram%20%C3%A9.png`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(res.headers.get("etag")).toBe(`"${createHash("sha256").update(PNG).digest("hex")}"`);
    expect(res.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("serves a file declared image/png that is not a PNG as an octet-stream download", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const ref = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "fake.png", type: "image/png", bytes: html }));
    expect(ref).toMatchObject({ contentType: "application/octet-stream", image: false });
    const res = await getBytes("carol", ref, "fake.png");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")?.startsWith('attachment; filename="fake.png"')).toBe(true);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 304 to a matching If-None-Match, and 200 to a stale one", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const ref = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "a.png", bytes: PNG }));
    const etag = (await getBytes("carol", ref)).headers.get("etag") ?? "";
    for (const inm of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const res = await getBytes("carol", ref, "a.png", { "if-none-match": inm });
      expect(res.status, inm).toBe(304);
      expect(res.headers.get("etag")).toBe(etag);
      expect(await res.text()).toBe("");
    }
    expect((await getBytes("carol", ref, "a.png", { "if-none-match": '"stale"' })).status).toBe(200);
  });

  it("checks visibility BEFORE any 304: a caller who cannot see the page gets 404 even with the right ETag", async () => {
    const page = await createPageAs("alice", "plat", { title: "Plat" });
    const ref = await readJson<AttachmentRef>(await upload("alice", "PLAT", page.id, { name: "a.png", bytes: PNG }));
    const etag = (await getBytes("bob", ref)).headers.get("etag") ?? "";
    await expectProblem(await getBytes("carol", ref, "a.png", { "if-none-match": etag }), 404, "NOT_FOUND");
    await expectProblem(await getBytes("carol", ref, "a.png", { "if-none-match": "*" }), 404, "NOT_FOUND");
    await expectProblem(await getBytes(null, ref, "a.png", { "if-none-match": etag }), 401, "UNAUTHENTICATED");
  });

  it("treats the filename segment as cosmetic: never a 404 on a mismatch, never echoed into a header", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const ref = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "real.png", bytes: PNG }));
    const res = await getBytes("carol", ref, 'evil"; filename=x.html\r\nSet-Cookie: a=b');
    expect(res.status).toBe(200);
    const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    expect(headers).not.toContain("evil");
    expect(headers).not.toContain("x.html");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-disposition")).toContain('filename="real.png"');
  });

  it("still serves a hidden attachment (old versions render it), but not one of a deleted page", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const ref = await readJson<AttachmentRef>(await upload("bob", "TEAM", page.id, { name: "a.png", bytes: PNG }));
    await send(hideRoute.DELETE, "DELETE", `${attachmentsUrl("TEAM", page.id)}/${ref.id}`, { spaceKey: "TEAM", id: page.id, attachmentId: ref.id }, { session: session.bob });
    expect((await getBytes("carol", ref)).status).toBe(200);
    await prisma.document.update({ where: { id: page.id }, data: { deletedAt: new Date(), deletedById: (await prisma.user.findFirstOrThrow()).id, deletedRootId: page.id } });
    await expectProblem(await getBytes("carol", ref), 404, "NOT_FOUND");
  });

  it("is 404 for an unknown or malformed id", async () => {
    await expectProblem(await getBytes("alice", { id: "c0000000000000000000000000" }), 404, "NOT_FOUND");
    await expectProblem(await getBytes("alice", { id: "../../etc" }), 404, "NOT_FOUND");
  });
});
