// The dialogs' REST calls: methods, URLs and bodies as 08 §3 takes them, and success bodies read
// defensively. (The integration test sends the same calls to the real route handlers.)
import { describe, expect, it } from "vitest";
import { ApiError } from "@/ui/api-client";
import { suggestCopyTitle } from "../copy-suggestion";
import { fetchAttachments, fetchDescendantCount, parseAttachment, requestCopy, requestDelete, requestHide, requestMove, requestUpload } from "../page-requests";

type Sent = { url: string; method: string; body: unknown; contentType: string | null };

function recorder(respond: () => Response) {
  const sent: Sent[] = [];
  const fetchImpl = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url, method: init?.method ?? "GET", body: init?.body, contentType: headers.get("content-type") });
    return Promise.resolve(respond());
  };
  return { sent, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ATTACHMENT = {
  id: "a1",
  filename: "spec.pdf",
  contentType: "application/octet-stream",
  size: 2048,
  url: "/api/v1/attachments/a1/spec.pdf",
  image: false,
  uploadedBy: { id: "u1", name: "Alice" },
  createdAt: "2026-10-11T09:00:00.000Z",
};

describe("parseAttachment", () => {
  it("accepts an AttachmentRef", () => {
    expect(parseAttachment(ATTACHMENT)).toEqual(ATTACHMENT);
  });

  it.each([
    ["no id", { ...ATTACHMENT, id: 1 }],
    ["size not a number", { ...ATTACHMENT, size: "2048" }],
    ["image not a boolean", { ...ATTACHMENT, image: "yes" }],
    ["a URL that is not an attachment URL", { ...ATTACHMENT, url: "javascript:alert(1)" }],
    ["an absolute URL elsewhere", { ...ATTACHMENT, url: "https://evil.example/a1/spec.pdf" }],
    ["no uploader name", { ...ATTACHMENT, uploadedBy: { id: "u1" } }],
    ["not an object", "spec.pdf"],
  ])("refuses %s", (_label, value) => {
    expect(parseAttachment(value)).toBeNull();
  });
});

describe("the calls", () => {
  it("GET attachments, and a malformed list is UNEXPECTED_RESPONSE", async () => {
    const ok = recorder(() => json([ATTACHMENT]));
    expect(await fetchAttachments("TEAM", "p1", ok.fetchImpl)).toEqual([ATTACHMENT]);
    expect(ok.sent[0]).toMatchObject({ url: "/api/v1/spaces/TEAM/pages/p1/attachments", method: "GET" });

    for (const body of [{ items: [] }, [ATTACHMENT, { id: "broken" }]]) {
      const bad = recorder(() => json(body));
      await expect(fetchAttachments("TEAM", "p1", bad.fetchImpl)).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE" });
    }
  });

  it("uploads multipart with one `file` field and no JSON Content-Type", async () => {
    const r = recorder(() => json(ATTACHMENT, 201));
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await requestUpload("TEAM", "p1", file, file.name, r.fetchImpl);
    const sent = r.sent[0] as Sent;
    expect(sent).toMatchObject({ url: "/api/v1/spaces/TEAM/pages/p1/attachments", method: "POST", contentType: null });
    expect(sent.body).toBeInstanceOf(FormData);
    const field = (sent.body as FormData).getAll("file");
    expect(field).toHaveLength(1);
    expect((field[0] as File).name).toBe("notes.txt");
  });

  it("hides with DELETE on the attachment's URL, segments encoded", async () => {
    const r = recorder(() => new Response(null, { status: 204 }));
    await requestHide("TEAM", "p1", "a/1", r.fetchImpl);
    expect(r.sent[0]).toMatchObject({ url: "/api/v1/spaces/TEAM/pages/p1/attachments/a%2F1", method: "DELETE" });
  });

  it("copies with { title } and returns the new id; a 201 without an id is null, not an error", async () => {
    const r = recorder(() => json({ id: "p9", title: "Copy of Spec" }, 201));
    expect(await requestCopy("TEAM", "p1", "Copy of Spec", r.fetchImpl)).toBe("p9");
    expect(r.sent[0]).toMatchObject({ url: "/api/v1/spaces/TEAM/pages/p1/copy", method: "POST", contentType: "application/json" });
    expect(JSON.parse(r.sent[0]?.body as string)).toEqual({ title: "Copy of Spec" });

    const odd = recorder(() => json({}, 201));
    expect(await requestCopy("TEAM", "p1", "x", odd.fetchImpl)).toBeNull();
  });

  it("moves with exactly { parentId, index }", async () => {
    const r = recorder(() => json({ id: "p1" }));
    await requestMove("TEAM", "p1", { parentId: null, index: 3 }, r.fetchImpl);
    expect(r.sent[0]).toMatchObject({ url: "/api/v1/spaces/TEAM/pages/p1/move", method: "POST" });
    expect(JSON.parse(r.sent[0]?.body as string)).toEqual({ parentId: null, index: 3 });
  });

  it("deletes the page and reads deletedCount", async () => {
    const r = recorder(() => json({ deletedCount: 4 }));
    expect(await requestDelete("TEAM", "p1", r.fetchImpl)).toBe(4);
    expect(r.sent[0]).toMatchObject({ url: "/api/v1/spaces/TEAM/pages/p1", method: "DELETE" });
  });

  it("reads the page's live descendantCount from GET …/pages/{id}, segments encoded", async () => {
    const r = recorder(() => json({ page: { id: "a/b", descendantCount: 3 }, version: { number: 1 } }));
    expect(await fetchDescendantCount("日本", "a/b", r.fetchImpl)).toBe(3);
    expect(r.sent).toEqual([{ url: `/api/v1/spaces/${encodeURIComponent("日本")}/pages/a%2Fb`, method: "GET", body: undefined, contentType: null }]);
  });

  it.each([[{}], [{ page: null }], [{ page: {} }], [{ page: { descendantCount: "3" } }], [{ page: { descendantCount: -1 } }], [{ page: { descendantCount: 1.5 } }], [[]]])(
    "a count that is not a whole number of pages is UNEXPECTED_RESPONSE, never a guess: %j",
    async (body) => {
      const r = recorder(() => json(body));
      await expect(fetchDescendantCount("TEAM", "p1", r.fetchImpl)).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE" });
    },
  );

  it("a refusal is the problem's ApiError", async () => {
    const r = recorder(() => json({ type: "about:blank", title: "x", status: 409, detail: "", code: "CYCLE" }, 409));
    const error = await requestMove("TEAM", "p1", { parentId: "p2", index: 0 }, r.fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "CYCLE", status: 409 });
  });
});

describe("suggestCopyTitle (RD-056, RD-067)", () => {
  it("is `Copy of <title>`, numbered past titles already taken, case-insensitively", () => {
    expect(suggestCopyTitle("Spec", [{ title: "Spec" }])).toBe("Copy of Spec");
    expect(suggestCopyTitle("Spec", [{ title: "Spec" }, { title: "copy of spec" }])).toBe("Copy of Spec 2");
    expect(suggestCopyTitle("Spec", [{ title: "Copy of Spec" }, { title: "Copy of Spec 2" }])).toBe("Copy of Spec 3");
  });

  it("never exceeds 255 characters", () => {
    expect(suggestCopyTitle("x".repeat(255), []).length).toBeLessThanOrEqual(255);
  });
});
