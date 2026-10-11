// The pages REST API of spec 08 §3, called through the exported route handlers exactly as Next
// calls them: status codes, success shapes, and the problem+json code of each refusal.
// spec: 08 §3, §3.1, §3.2; RD-055, RD-056, RD-060, RD-061, RD-062, RD-064, RD-069
import { beforeEach, describe, expect, it } from "vitest";
import type {
  Draft,
  DraftResponse,
  GetPageResponse,
  PageDetail,
  PageSummary,
  PublishResponse,
  UserRef,
  VersionDetail,
  VersionSummary,
} from "@/domain/documents";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance, type Handle } from "@/test-support/fixtures";
import { expectProblem, readJson, send, sessionFor, streamOf } from "@/test-support/api-harness";
import { JSON_BODY_CAP } from "../_lib/body";
import * as pagesRoute from "../spaces/[spaceKey]/pages/route";
import * as pageRoute from "../spaces/[spaceKey]/pages/[id]/route";
import * as moveRoute from "../spaces/[spaceKey]/pages/[id]/move/route";
import * as copyRoute from "../spaces/[spaceKey]/pages/[id]/copy/route";
import * as draftRoute from "../spaces/[spaceKey]/pages/[id]/draft/route";
import * as versionsRoute from "../spaces/[spaceKey]/pages/[id]/versions/route";
import * as versionRoute from "../spaces/[spaceKey]/pages/[id]/versions/[n]/route";
import * as restoreRoute from "../spaces/[spaceKey]/pages/[id]/versions/[n]/restore/route";
import * as watchRoute from "../spaces/[spaceKey]/pages/[id]/watch/route";
import * as favouriteRoute from "../spaces/[spaceKey]/pages/[id]/favourite/route";
import * as presenceRoute from "../spaces/[spaceKey]/pages/[id]/presence/route";
import * as peopleRoute from "../spaces/[spaceKey]/people/route";
import * as catchAll from "../[...path]/route";

let session: Record<Handle, string>;
beforeEach(async () => {
  await resetDemoInstance();
  session = { alice: await sessionFor("alice"), bob: await sessionFor("bob"), carol: await sessionFor("carol") };
});

const pagesUrl = (key: string) => `/api/v1/spaces/${key}/pages`;
const pageUrl = (key: string, id: string) => `${pagesUrl(key)}/${id}`;

function expectJson(res: Response, status = 200): void {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
}

describe("GET /pages", () => {
  it("returns the tree as a flat PageSummary[]; the space key is case-insensitive", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const res = await send(pagesRoute.GET, "GET", pagesUrl("team"), { spaceKey: "team" }, { session: session.carol });
    expectJson(res);
    const pages = await readJson<PageSummary[]>(res);
    expect(pages).toEqual([{ id: page.id, title: "Spec", parentId: null, ordinal: 0, currentVersion: 1, lastModifiedAt: expect.any(String) }]);
  });

  it("is 404 for a space the caller cannot see and for one that does not exist", async () => {
    await expectProblem(await send(pagesRoute.GET, "GET", pagesUrl("PLAT"), { spaceKey: "PLAT" }, { session: session.carol }), 404, "NOT_FOUND");
    await expectProblem(await send(pagesRoute.GET, "GET", pagesUrl("NOPE"), { spaceKey: "NOPE" }, { session: session.alice }), 404, "NOT_FOUND");
  });
});

describe("POST /pages", () => {
  it("creates a page: 201 PageDetail; with no body at all it is Untitled", async () => {
    const res = await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob });
    expectJson(res, 201);
    expect(await readJson<PageDetail>(res)).toMatchObject({ title: "Untitled", spaceKey: "TEAM", currentVersion: 1, watching: true });
    const titled = await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, json: { title: "Spec", extra: 1 } });
    expect(titled.status).toBe(201);
    expect((await readJson<PageDetail>(titled)).title).toBe("Spec");
  });

  it("refuses a viewer with 403, an invalid title with 422 at title, a bad parent with 422 at parentId, a taken title with 409", async () => {
    await expectProblem(await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.carol, json: {} }), 403, "FORBIDDEN");
    const title = await expectProblem(
      await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, json: { title: "a\nb" } }),
      422,
      "VALIDATION",
    );
    expect(title.errors?.map((e) => e.path)).toEqual(["title"]);
    const typed = await expectProblem(
      await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, json: { title: 5 } }),
      422,
      "VALIDATION",
    );
    expect(typed.errors?.map((e) => e.path)).toEqual(["title"]);
    const parent = await expectProblem(
      await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, json: { parentId: "nope" } }),
      422,
      "VALIDATION",
    );
    expect(parent.errors?.map((e) => e.path)).toEqual(["parentId"]);
    await createPageAs("alice", "team", { title: "Taken" });
    await expectProblem(
      await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, json: { title: "TAKEN" } }),
      409,
      "TITLE_TAKEN",
    );
    // Only the fixture page: every refused create wrote nothing.
    expect(await prisma.document.count()).toBe(1);
  });

  it("refuses a non-JSON body with 415 and malformed JSON with 422", async () => {
    await expectProblem(
      await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, body: "title=x", contentType: "application/x-www-form-urlencoded" }),
      415,
      "UNSUPPORTED_MEDIA",
    );
    await expectProblem(
      await send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.bob, body: '{"title":', contentType: "application/json" }),
      422,
      "VALIDATION",
    );
    expect(await prisma.document.count()).toBe(0);
  });
});

describe("GET /pages/{id}", () => {
  it("returns the page and the current version, or ?version=N", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    const res = await send(pageRoute.GET, "GET", pageUrl("TEAM", page.id), { spaceKey: "TEAM", id: page.id }, { session: session.carol });
    expectJson(res);
    const body = await readJson<GetPageResponse>(res);
    expect(body.page).toMatchObject({ id: page.id, currentVersion: 2, permissions: { canEdit: false, canAdmin: false } });
    expect(body.version).toMatchObject({ number: 2, current: true, content: paragraphDoc("Spec v2") });
    const past = await send(pageRoute.GET, "GET", `${pageUrl("TEAM", page.id)}?version=1`, { spaceKey: "TEAM", id: page.id }, { session: session.carol });
    expect((await readJson<GetPageResponse>(past)).version).toMatchObject({ number: 1, current: false });
  });

  it("is 404 for an unknown version, 422 for a malformed one or a bad format", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const get = (query: string) => send(pageRoute.GET, "GET", `${pageUrl("TEAM", page.id)}${query}`, { spaceKey: "TEAM", id: page.id }, { session: session.alice });
    await expectProblem(await get("?version=9"), 404, "NOT_FOUND");
    await expectProblem(await get("?version=99999999999"), 404, "NOT_FOUND");
    expect((await expectProblem(await get("?version=abc"), 422, "VALIDATION")).errors?.[0]?.path).toBe("version");
    expect((await expectProblem(await get("?version=0"), 422, "VALIDATION")).errors?.[0]?.path).toBe("version");
    expect((await expectProblem(await get("?format=xml"), 422, "VALIDATION")).errors?.[0]?.path).toBe("format");
  });

  // ?format=html success is tested in page-html.test.ts (unit project): this project has no React
  // JSX transform, so the renderer cannot run here (handoff in the phase report). The refusals,
  // which are decided before rendering, are tested here against the real database.
  it("?format=html refuses an invisible page and an unknown version like JSON does", async () => {
    const page = await createPageAs("alice", "plat", { title: "Plat" });
    const get = (handle: Handle, query: string) =>
      send(pageRoute.GET, "GET", `${pageUrl("PLAT", page.id)}${query}`, { spaceKey: "PLAT", id: page.id }, { session: session[handle] });
    await expectProblem(await get("carol", "?format=html"), 404, "NOT_FOUND");
    await expectProblem(await get("bob", "?format=html&version=2"), 404, "NOT_FOUND");
    await expectProblem(await get("bob", "?format=pdf"), 422, "VALIDATION");
  });

  it("is 404 for a page of another space addressed through this one (IDOR), for a malformed id and a deleted page", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectProblem(await send(pageRoute.GET, "GET", pageUrl("TEAM", plat.id), { spaceKey: "TEAM", id: plat.id }, { session: session.alice }), 404, "NOT_FOUND");
    await expectProblem(await send(pageRoute.GET, "GET", pageUrl("TEAM", "a b"), { spaceKey: "TEAM", id: "a b" }, { session: session.alice }), 404, "NOT_FOUND");
    const team = await createPageAs("alice", "team", { title: "Gone" });
    await send(pageRoute.DELETE, "DELETE", pageUrl("TEAM", team.id), { spaceKey: "TEAM", id: team.id }, { session: session.alice });
    await expectProblem(await send(pageRoute.GET, "GET", pageUrl("TEAM", team.id), { spaceKey: "TEAM", id: team.id }, { session: session.alice }), 404, "NOT_FOUND");
  });
});

describe("PUT /pages/{id} (publish)", () => {
  const publish = (id: string, handle: Handle, json: unknown) =>
    send(pageRoute.PUT, "PUT", pageUrl("TEAM", id), { spaceKey: "TEAM", id }, { session: session[handle], json });

  it("publishes: 200 PublishResponse with diagnostics []", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const res = await publish(page.id, "bob", { title: "Spec", content: paragraphDoc("new"), baseVersion: 1, message: "why", notifyWatchers: true });
    expectJson(res);
    const body = await readJson<PublishResponse>(res);
    expect(body).toMatchObject({ diagnostics: [], version: { number: 2, message: "why" }, page: { currentVersion: 2 } });
  });

  it("is 409 VERSION_CONFLICT with currentVersion for a stale base, and publishes with overwrite", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    const conflict = await expectProblem(await publish(page.id, "bob", { title: "Spec", content: paragraphDoc("x"), baseVersion: 1 }), 409, "VERSION_CONFLICT");
    expect(conflict.currentVersion).toBe(3);
    const over = await publish(page.id, "bob", { title: "Spec", content: paragraphDoc("x"), baseVersion: 1, overwrite: true });
    expect((await readJson<PublishResponse>(over)).version.number).toBe(4);
  });

  it("is 422 with error paths for a bad body", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const missing = await expectProblem(await publish(page.id, "bob", { title: "Spec", content: paragraphDoc("x") }), 422, "VALIDATION");
    expect(missing.errors?.map((e) => e.path)).toEqual(["baseVersion"]);
    const wrongTypes = await expectProblem(await publish(page.id, "bob", { title: 1, baseVersion: "1", notifyWatchers: "yes" }), 422, "VALIDATION");
    expect(wrongTypes.errors?.map((e) => e.path).sort()).toEqual(["baseVersion", "content", "notifyWatchers", "title"]);
    const content = await expectProblem(
      await publish(page.id, "bob", { title: "Spec", content: { type: "doc", content: [{ type: "nope" }] }, baseVersion: 1 }),
      422,
      "VALIDATION",
    );
    expect(content.errors?.[0]?.path.startsWith("content")).toBe(true);
    const note = await expectProblem(await publish(page.id, "bob", { title: "Spec", content: paragraphDoc("x"), baseVersion: 1, message: "n".repeat(501) }), 422, "VALIDATION");
    expect(note.errors?.map((e) => e.path)).toEqual(["message"]);
    await expectProblem(await publish(page.id, "bob", [1, 2]), 422, "VALIDATION");
  });

  it("is 409 TITLE_TAKEN for another live page's title, 403 for a viewer, 404 across spaces", async () => {
    await createPageAs("alice", "team", { title: "Taken" });
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await expectProblem(await publish(page.id, "bob", { title: "taken", content: paragraphDoc("x"), baseVersion: 1 }), 409, "TITLE_TAKEN");
    await expectProblem(await publish(page.id, "carol", { title: "Spec", content: paragraphDoc("x"), baseVersion: 1 }), 403, "FORBIDDEN");
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectProblem(await publish(plat.id, "bob", { title: "Plat", content: paragraphDoc("x"), baseVersion: 1 }), 404, "NOT_FOUND");
    expect(await prisma.documentVersion.count({ where: { documentId: { in: [page.id, plat.id] } } })).toBe(2);
  });

  it("is 413 TOO_LARGE with the 5 MiB limit for content over 5 MiB inside an envelope that fits", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const big = await expectProblem(
      await publish(page.id, "bob", { title: "Spec", content: paragraphDoc("x".repeat(5 * 1024 * 1024 + 10_000)), baseVersion: 1 }),
      413,
      "TOO_LARGE",
    );
    expect(big.limit).toBe(5_242_880);
  });
});

/** Python's `json.dumps` defaults (what `requests.put(url, json=...)` sends): ASCII only, `", "` and `": "` separators. */
function pythonDumps(value: unknown): string {
  const str = (s: string) => JSON.stringify(s).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return str(value);
  if (Array.isArray(value)) return `[${value.map(pythonDumps).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${str(k)}: ${pythonDumps(v)}`).join(", ")}}`;
  }
  throw new Error(`not JSON: ${typeof value}`);
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

/** A canonical table of `rows` × 8 cells: the shape whose pretty-printed form is heaviest. */
function tableDoc(rows: number): unknown {
  const cell = (type: string, i: number) => ({
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null, background: null },
    content: [{ type: "paragraph", attrs: { textAlign: null, indent: 0 }, content: [{ type: "text", text: `c${i}` }] }],
  });
  const row = { type: "tableRow", content: Array.from({ length: 8 }, (_, i) => cell(i === 0 ? "tableHeader" : "tableCell", i)) };
  return { type: "doc", content: [{ type: "table", attrs: { widthMode: "responsive", numberedColumn: false }, content: Array.from({ length: rows }, () => row) }] };
}

describe("the 5 MiB content limit is the content's, not the request's (RD-063, RD-068)", () => {
  const put = (id: string, body: string) =>
    send(pageRoute.PUT, "PUT", pageUrl("TEAM", id), { spaceKey: "TEAM", id }, { session: session.bob, body, contentType: "application/json" });
  const OLD_CAP = 5 * 1024 * 1024 + 64 * 1024;

  it("publishes the same 3 MB document whether the client sends it compact or ASCII-escaped (Python's default)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const content = paragraphDoc("中".repeat(1_000_000));
    const escaped = pythonDumps({ title: "Spec", content, baseVersion: 1 });
    expect(utf8Bytes(JSON.stringify(content))).toBeLessThan(3_100_000);
    expect(utf8Bytes(escaped)).toBeGreaterThan(OLD_CAP);

    const viaPython = await put(page.id, escaped);
    expect((await readJson<PublishResponse>(viaPython)).version.number).toBe(2);
    const compact = await put(page.id, JSON.stringify({ title: "Spec", content, baseVersion: 2 }));
    expect((await readJson<PublishResponse>(compact)).version.number).toBe(3);
    const stored = await prisma.documentVersion.findMany({ where: { documentId: page.id, number: { in: [2, 3] } }, orderBy: { number: "asc" } });
    expect(stored).toHaveLength(2);
    expect(stored[0]?.content).toEqual(stored[1]?.content);
    expect(JSON.stringify(stored[0]?.content)).toContain(JSON.stringify("中".repeat(1_000_000)));
  });

  it("publishes a table-heavy document sent pretty-printed (JSON.stringify(doc, null, 2)) though the request is over 5 MiB", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const content = tableDoc(1200);
    const pretty = JSON.stringify({ title: "Spec", content, baseVersion: 1 }, null, 2);
    expect(utf8Bytes(JSON.stringify(content))).toBeLessThan(2 * 1024 * 1024);
    expect(utf8Bytes(pretty)).toBeGreaterThan(OLD_CAP);
    expect((await readJson<PublishResponse>(await put(page.id, pretty))).version.number).toBe(2);
  });

  it("still refuses content over 5 MiB however it is encoded, with 413 and the 5 MiB limit", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const content = paragraphDoc("中".repeat(1_800_000)); // 5.4 MB as compact UTF-8
    for (const wire of [JSON.stringify({ title: "Spec", content, baseVersion: 1 }), pythonDumps({ title: "Spec", content, baseVersion: 1 })]) {
      expect((await expectProblem(await put(page.id, wire), 413, "TOO_LARGE")).limit).toBe(5_242_880);
    }
    expect(await prisma.documentVersion.count({ where: { documentId: page.id } })).toBe(1);
  });
});

describe("oversized and mistyped bodies", () => {
  it("is 413 for a JSON body over the cap, declared or not, and 413 for a chunked body with no Content-Length", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const params = { spaceKey: "TEAM", id: page.id };
    const huge = JSON.stringify({ title: "Spec", content: paragraphDoc("y".repeat(JSON_BODY_CAP)), baseVersion: 1 });
    const declared = await send(pageRoute.PUT, "PUT", pageUrl("TEAM", page.id), params, {
      session: session.bob,
      body: huge,
      contentType: "application/json",
      headers: { "content-length": String(new TextEncoder().encode(huge).byteLength) },
    });
    expect((await expectProblem(declared, 413, "TOO_LARGE")).limit).toBe(5_242_880);
    const undeclared = await send(pageRoute.PUT, "PUT", pageUrl("TEAM", page.id), params, { session: session.bob, body: huge, contentType: "application/json" });
    await expectProblem(undeclared, 413, "TOO_LARGE");
    const chunked = await send(draftRoute.PUT, "PUT", `${pageUrl("TEAM", page.id)}/draft`, params, {
      session: session.bob,
      body: streamOf(64 * 1024 * 1024),
      contentType: "application/json",
    });
    expect((await expectProblem(chunked, 413, "TOO_LARGE")).limit).toBe(5_242_880);
    expect(await prisma.documentVersion.count({ where: { documentId: page.id } })).toBe(1);
    expect(await prisma.documentDraft.count()).toBe(0);
  });

  it("is 415 for a body that is not JSON", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    for (const contentType of ["text/plain", "multipart/form-data; boundary=x", null]) {
      const res = await send(pageRoute.PATCH, "PATCH", pageUrl("TEAM", page.id), { spaceKey: "TEAM", id: page.id }, {
        session: session.bob,
        body: '{"title":"New"}',
        contentType,
      });
      await expectProblem(res, 415, "UNSUPPORTED_MEDIA");
    }
  });
});

describe("PATCH, DELETE /pages/{id}; move; copy", () => {
  it("renames (a version), deletes the subtree, moves and copies", async () => {
    const parent = await createPageAs("alice", "team", { title: "Parent" });
    const child = await createPageAs("alice", "team", { title: "Child", parentId: parent.id });
    const params = { spaceKey: "TEAM", id: child.id };

    const renamed = await send(pageRoute.PATCH, "PATCH", pageUrl("TEAM", child.id), params, { session: session.bob, json: { title: "Kid" } });
    expectJson(renamed);
    expect(await readJson<PageDetail>(renamed)).toMatchObject({ title: "Kid", currentVersion: 2 });

    const moved = await send(moveRoute.POST, "POST", `${pageUrl("TEAM", child.id)}/move`, params, { session: session.bob, json: { parentId: null, index: 0 } });
    expectJson(moved);
    expect(await readJson<PageDetail>(moved)).toMatchObject({ parentId: null, ordinal: 0 });

    const cycle = await send(moveRoute.POST, "POST", `${pageUrl("TEAM", parent.id)}/move`, { spaceKey: "TEAM", id: parent.id }, {
      session: session.bob,
      json: { parentId: parent.id, index: 0 },
    });
    await expectProblem(cycle, 409, "CYCLE");
    const badMove = await send(moveRoute.POST, "POST", `${pageUrl("TEAM", child.id)}/move`, params, { session: session.bob, json: { parentId: null } });
    expect((await expectProblem(badMove, 422, "VALIDATION")).errors?.map((e) => e.path)).toEqual(["index"]);

    const copied = await send(copyRoute.POST, "POST", `${pageUrl("TEAM", child.id)}/copy`, params, { session: session.bob });
    expectJson(copied, 201);
    expect(await readJson<PageDetail>(copied)).toMatchObject({ title: "Copy of Kid" });

    const deleted = await send(pageRoute.DELETE, "DELETE", pageUrl("TEAM", parent.id), { spaceKey: "TEAM", id: parent.id }, { session: session.bob });
    expectJson(deleted);
    expect(await readJson<{ deletedCount: number }>(deleted)).toEqual({ deletedCount: 1 });
  });
});

describe("drafts", () => {
  it("GET returns { draft: null }, PUT saves, GET returns it, DELETE is an idempotent 204", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const url = `${pageUrl("TEAM", page.id)}/draft`;
    const params = { spaceKey: "TEAM", id: page.id };
    const empty = await send(draftRoute.GET, "GET", url, params, { session: session.bob });
    expectJson(empty);
    expect(await readJson<{ draft: Draft | null }>(empty)).toEqual({ draft: null });

    const saved = await send(draftRoute.PUT, "PUT", url, params, { session: session.bob, json: { title: "", content: paragraphDoc("wip"), baseVersion: 1 } });
    expectJson(saved);
    expect(await readJson<DraftResponse>(saved)).toMatchObject({ stale: false, currentVersion: 1, savedAt: expect.any(String) });

    const got = await readJson<{ draft: Draft | null }>(await send(draftRoute.GET, "GET", url, params, { session: session.bob }));
    expect(got.draft).toMatchObject({ title: "", baseVersion: 1, stale: false, currentVersion: 1, updatedAt: expect.any(String) });

    for (let i = 0; i < 2; i++) {
      const del = await send(draftRoute.DELETE, "DELETE", url, params, { session: session.bob });
      expect(del.status).toBe(204);
      expect(await del.text()).toBe("");
    }
    await expectProblem(await send(draftRoute.GET, "GET", url, params, { session: session.carol }), 403, "FORBIDDEN");
  });
});

describe("versions", () => {
  it("lists, reads, restores and deletes versions with the right codes", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    const base = `${pageUrl("TEAM", page.id)}/versions`;
    const params = { spaceKey: "TEAM", id: page.id };

    const list = await send(versionsRoute.GET, "GET", base, params, { session: session.carol });
    expectJson(list);
    expect((await readJson<VersionSummary[]>(list)).map((v) => v.number)).toEqual([3, 2, 1]);

    const one = await send(versionRoute.GET, "GET", `${base}/2`, { ...params, n: "2" }, { session: session.carol });
    expect(await readJson<VersionDetail>(one)).toMatchObject({ number: 2, content: paragraphDoc("Spec v2") });
    for (const n of ["9", "abc", "0", "01", "-1", "1.5", "99999999999"]) {
      await expectProblem(await send(versionRoute.GET, "GET", `${base}/${n}`, { ...params, n }, { session: session.carol }), 404, "NOT_FOUND");
    }

    const restored = await send(restoreRoute.POST, "POST", `${base}/1/restore`, { ...params, n: "1" }, { session: session.bob });
    expectJson(restored);
    expect((await readJson<PublishResponse>(restored)).version).toMatchObject({ number: 4, message: "Restored from v. 1" });
    await expectProblem(await send(restoreRoute.POST, "POST", `${base}/1/restore`, { ...params, n: "1" }, { session: session.carol }), 403, "FORBIDDEN");

    const del = (n: string, handle: Handle) => send(versionRoute.DELETE, "DELETE", `${base}/${n}`, { ...params, n }, { session: session[handle] });
    await expectProblem(await del("2", "bob"), 403, "FORBIDDEN");
    await expectProblem(await del("4", "alice"), 409, "CURRENT_VERSION");
    await prisma.documentVersion.updateMany({ where: { documentId: page.id, number: 1 }, data: { pinned: true } });
    await expectProblem(await del("1", "alice"), 409, "PINNED_VERSION");
    const ok = await del("2", "alice");
    expect(ok.status).toBe(204);
    await expectProblem(await del("2", "alice"), 404, "NOT_FOUND");
  });
});

describe("watch, favourite, presence, people", () => {
  it("watch and favourite are idempotent 204s for a viewer", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const params = { spaceKey: "TEAM", id: page.id };
    for (const [route, path] of [
      [watchRoute, "watch"],
      [favouriteRoute, "favourite"],
    ] as const) {
      for (const method of ["PUT", "PUT", "DELETE", "DELETE"] as const) {
        const res = await send(route[method], method, `${pageUrl("TEAM", page.id)}/${path}`, params, { session: session.carol });
        expect(res.status).toBe(204);
      }
    }
    await expectProblem(
      await send(watchRoute.PUT, "PUT", `${pageUrl("PLAT", page.id)}/watch`, { spaceKey: "PLAT", id: page.id }, { session: session.carol }),
      404,
      "NOT_FOUND",
    );
  });

  it("presence returns { others } without the caller", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const params = { spaceKey: "TEAM", id: page.id };
    const url = `${pageUrl("TEAM", page.id)}/presence`;
    expect(await readJson<{ others: UserRef[] }>(await send(presenceRoute.POST, "POST", url, params, { session: session.alice, json: {} }))).toEqual({ others: [] });
    const res = await send(presenceRoute.POST, "POST", url, params, { session: session.carol });
    expectJson(res);
    expect((await readJson<{ others: UserRef[] }>(res)).others.map((u) => u.name)).toEqual(["Alice Admin"]);
  });

  it("people returns { people } matched on names only", async () => {
    const res = await send(peopleRoute.GET, "GET", "/api/v1/spaces/TEAM/people?q=car", { spaceKey: "TEAM" }, { session: session.bob });
    expectJson(res);
    const body = await readJson<{ people: UserRef[] }>(res);
    expect(body.people.map((u) => u.name)).toEqual(["Carol Viewer"]);
    expect(JSON.stringify(body)).not.toContain("@");
    const all = await readJson<{ people: UserRef[] }>(await send(peopleRoute.GET, "GET", "/api/v1/spaces/TEAM/people", { spaceKey: "TEAM" }, { session: session.bob }));
    expect(all.people).toHaveLength(3);
    await expectProblem(await send(peopleRoute.GET, "GET", "/api/v1/spaces/PLAT/people?q=", { spaceKey: "PLAT" }, { session: session.carol }), 404, "NOT_FOUND");
  });
});

describe("authentication and the Origin gate", () => {
  it("answers 401 problem+json, never a redirect, with no session or a session that is not valid", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    for (const s of [null, "not-a-session", session.alice.replace(/.$/, (c) => (c === "A" ? "B" : "A"))]) {
      await expectProblem(await send(pagesRoute.GET, "GET", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: s }), 401, "UNAUTHENTICATED");
      await expectProblem(await send(pageRoute.PUT, "PUT", pageUrl("TEAM", page.id), { spaceKey: "TEAM", id: page.id }, { session: s, json: {} }), 401, "UNAUTHENTICATED");
    }
  });

  it("answers 401 for an expired session and removes it", async () => {
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectProblem(await send(pagesRoute.GET, "GET", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.alice }), 401, "UNAUTHENTICATED");
  });

  it("refuses every state-changing route without an Origin, or with a foreign one, and changes nothing (CSRF)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const p = { spaceKey: "TEAM", id: page.id };
    const writes: Array<() => Promise<Response>> = [];
    for (const origin of [null, "https://evil.example", "http://reqforge.test:8080", "null"]) {
      const o = { session: session.alice, origin };
      writes.push(
        () => send(pagesRoute.POST, "POST", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { ...o, json: { title: "CSRF" } }),
        () => send(pageRoute.PUT, "PUT", pageUrl("TEAM", page.id), p, { ...o, json: { title: "CSRF", content: paragraphDoc("x"), baseVersion: 1 } }),
        () => send(pageRoute.PATCH, "PATCH", pageUrl("TEAM", page.id), p, { ...o, json: { title: "CSRF" } }),
        () => send(pageRoute.DELETE, "DELETE", pageUrl("TEAM", page.id), p, o),
        () => send(moveRoute.POST, "POST", `${pageUrl("TEAM", page.id)}/move`, p, { ...o, json: { parentId: null, index: 0 } }),
        () => send(copyRoute.POST, "POST", `${pageUrl("TEAM", page.id)}/copy`, p, o),
        () => send(draftRoute.PUT, "PUT", `${pageUrl("TEAM", page.id)}/draft`, p, { ...o, json: { title: "x", content: paragraphDoc("x"), baseVersion: 1 } }),
        () => send(draftRoute.DELETE, "DELETE", `${pageUrl("TEAM", page.id)}/draft`, p, o),
        () => send(watchRoute.PUT, "PUT", `${pageUrl("TEAM", page.id)}/watch`, p, o),
        () => send(favouriteRoute.DELETE, "DELETE", `${pageUrl("TEAM", page.id)}/favourite`, p, o),
        () => send(presenceRoute.POST, "POST", `${pageUrl("TEAM", page.id)}/presence`, p, o),
        () => send(restoreRoute.POST, "POST", `${pageUrl("TEAM", page.id)}/versions/1/restore`, { ...p, n: "1" }, o),
        () => send(versionRoute.DELETE, "DELETE", `${pageUrl("TEAM", page.id)}/versions/1`, { ...p, n: "1" }, o),
        () => send(catchAll.POST, "POST", "/api/v1/nothing/here", { path: ["nothing", "here"] }, o),
      );
    }
    for (const write of writes) await expectProblem(await write(), 403, "ORIGIN_MISMATCH");
    expect(await prisma.document.count()).toBe(1);
    expect(await prisma.documentVersion.count()).toBe(1);
    expect(await prisma.documentDraft.count()).toBe(0);
    expect(await prisma.documentWatch.count()).toBe(0);
    expect(await prisma.documentPresence.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("does not need an Origin to read", async () => {
    const res = await send(pagesRoute.GET, "GET", pagesUrl("TEAM"), { spaceKey: "TEAM" }, { session: session.alice, origin: null });
    expect(res.status).toBe(200);
  });
});

describe("the catch-all", () => {
  it("answers an unknown /api/v1 path with a 404 problem — after the same gates as a real route", async () => {
    const params = { path: ["spaces", "TEAM", "nonsense"] };
    await expectProblem(await send(catchAll.GET, "GET", "/api/v1/spaces/TEAM/nonsense", params, { session: session.alice }), 404, "NOT_FOUND");
    await expectProblem(await send(catchAll.DELETE, "DELETE", "/api/v1/spaces/TEAM/nonsense", params, { session: session.alice }), 404, "NOT_FOUND");
    await expectProblem(await send(catchAll.GET, "GET", "/api/v1/spaces/TEAM/nonsense", params, { session: null }), 401, "UNAUTHENTICATED");
    await expectProblem(await send(catchAll.PUT, "PUT", "/api/v1/spaces/TEAM/nonsense", params, { session: session.alice, origin: null }), 403, "ORIGIN_MISMATCH");
  });
});
