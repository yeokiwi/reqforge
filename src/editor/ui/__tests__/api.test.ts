// The editor's pages-API client (08 §3) against a mocked fetch: the URLs and methods it calls,
// the JSON it sends, and how every problem+json code (08 §3.2), a non-problem error page and a
// network failure come back as a typed ApiError.
import { describe, expect, it, vi } from "vitest";
import type { ApiErrorCode, DraftRequest, PublishRequest } from "@/domain/documents/api-types";
import { AppError } from "@/domain/errors";
import { ApiError, type FetchLike, KEEPALIVE_MAX_BYTES, createPageApi, isRetryable, pageUrls, problemToError, toApiError } from "../api";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function json(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
}

function problem(status: number, code: string, extras: Record<string, unknown> = {}): Response {
  return json(status, { type: "about:blank", title: code, status, detail: `${code} detail`, code, ...extras }, "application/problem+json");
}

function mockFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, fetchImpl };
}

const PAGE = { spaceKey: "TEAM", pageId: "page_1" };
const DRAFT: DraftRequest = { title: "Specifications", content: { type: "doc", content: [] }, baseVersion: 3 };
const PUBLISH: PublishRequest = { ...DRAFT, message: "Fixed typos", notifyWatchers: true };

const PAGE_DETAIL = {
  id: "page_1",
  title: "Specifications",
  parentId: null,
  ordinal: 0,
  currentVersion: 4,
  lastModifiedAt: "2026-10-10T00:00:00.000Z",
  spaceKey: "TEAM",
  ancestors: [],
  createdBy: { id: "u1", name: "Alice" },
  createdAt: "2026-10-09T00:00:00.000Z",
  lastModifiedBy: { id: "u1", name: "Alice" },
  descendantCount: 0,
  watching: true,
  favourite: false,
  hasDraft: false,
  permissions: { canEdit: true, canAdmin: false },
};
const VERSION = {
  number: 4,
  title: "Specifications",
  message: null,
  author: { id: "u1", name: "Alice" },
  createdAt: "2026-10-10T00:00:00.000Z",
  current: true,
  pinned: false,
};

function bodyOf(call: Call | undefined): unknown {
  expect(call).toBeDefined();
  return JSON.parse(String(call?.init.body));
}

describe("URLs", () => {
  it("are the 08 §3 paths, with the space key and page id encoded", () => {
    expect(pageUrls.page(PAGE)).toBe("/api/v1/spaces/TEAM/pages/page_1");
    expect(pageUrls.draft(PAGE)).toBe("/api/v1/spaces/TEAM/pages/page_1/draft");
    expect(pageUrls.presence(PAGE)).toBe("/api/v1/spaces/TEAM/pages/page_1/presence");
    expect(pageUrls.attachments(PAGE)).toBe("/api/v1/spaces/TEAM/pages/page_1/attachments");
    expect(pageUrls.people("TEAM", "al ice")).toBe("/api/v1/spaces/TEAM/people?q=al%20ice");
    expect(pageUrls.page({ spaceKey: "A/B", pageId: "x?y" })).toBe("/api/v1/spaces/A%2FB/pages/x%3Fy");
  });
});

describe("successful calls", () => {
  it("saveDraft PUTs the DraftRequest as JSON and returns the DraftResponse", async () => {
    const { calls, fetchImpl } = mockFetch(json(200, { savedAt: "2026-10-10T00:00:01.000Z", stale: false, currentVersion: 3 }));
    const response = await createPageApi(PAGE, fetchImpl).saveDraft(DRAFT);
    expect(response).toEqual({ savedAt: "2026-10-10T00:00:01.000Z", stale: false, currentVersion: 3 });
    expect(calls[0]?.url).toBe("/api/v1/spaces/TEAM/pages/page_1/draft");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/json");
    expect(calls[0]?.init.credentials).toBe("same-origin");
    expect(calls[0]?.init.keepalive).toBe(false);
    expect(bodyOf(calls[0])).toEqual(DRAFT);
  });

  it("saveDraft uses keepalive only when asked and only for a body a browser lets keepalive carry", async () => {
    const big: DraftRequest = { ...DRAFT, content: { type: "doc", text: "x".repeat(KEEPALIVE_MAX_BYTES) } };
    const ok = () => json(200, { savedAt: "s", stale: true, currentVersion: 5 });
    const { calls, fetchImpl } = mockFetch(ok(), ok());
    const api = createPageApi(PAGE, fetchImpl);
    await api.saveDraft(DRAFT, { keepalive: true });
    await api.saveDraft(big, { keepalive: true });
    expect(calls.map((c) => c.init.keepalive)).toEqual([true, false]);
  });

  it("publish PUTs the PublishRequest to the page and returns the PublishResponse", async () => {
    const { calls, fetchImpl } = mockFetch(json(200, { page: PAGE_DETAIL, version: VERSION, diagnostics: [] }));
    const response = await createPageApi(PAGE, fetchImpl).publish({ ...PUBLISH, overwrite: true });
    expect(response.version.number).toBe(4);
    expect(response.diagnostics).toEqual([]);
    expect(calls[0]?.url).toBe("/api/v1/spaces/TEAM/pages/page_1");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(bodyOf(calls[0])).toEqual({ ...PUBLISH, overwrite: true });
  });

  it("discardDraft DELETEs the draft and accepts 204 with no body", async () => {
    const { calls, fetchImpl } = mockFetch(new Response(null, { status: 204 }));
    await expect(createPageApi(PAGE, fetchImpl).discardDraft()).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("/api/v1/spaces/TEAM/pages/page_1/draft");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("getDraft returns the draft or null", async () => {
    const draft = { ...DRAFT, updatedAt: "u", stale: true, currentVersion: 6 };
    const { fetchImpl } = mockFetch(json(200, { draft }), json(200, { draft: null }));
    const api = createPageApi(PAGE, fetchImpl);
    await expect(api.getDraft()).resolves.toEqual(draft);
    await expect(api.getDraft()).resolves.toBeNull();
  });

  it("getPage GETs the page and its current version's content", async () => {
    const { calls, fetchImpl } = mockFetch(json(200, { page: PAGE_DETAIL, version: { ...VERSION, content: { type: "doc" } } }));
    const response = await createPageApi(PAGE, fetchImpl).getPage();
    expect(response.version.content).toEqual({ type: "doc" });
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("heartbeat POSTs to presence and returns the other users, dropping malformed entries", async () => {
    const { calls, fetchImpl } = mockFetch(json(200, { others: [{ id: "u2", name: "Bob" }, { id: 3 }, null] }));
    await expect(createPageApi(PAGE, fetchImpl).heartbeat()).resolves.toEqual([{ id: "u2", name: "Bob" }]);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe("/api/v1/spaces/TEAM/pages/page_1/presence");
  });

  it("uploadAttachment POSTs multipart with the field `file` and no JSON content type", async () => {
    const ref = {
      id: "a1",
      filename: "x.png",
      contentType: "image/png",
      size: 3,
      url: "/api/v1/attachments/a1/x.png",
      image: true,
      uploadedBy: { id: "u1", name: "Alice" },
      createdAt: "c",
    };
    const { calls, fetchImpl } = mockFetch(json(201, ref));
    await expect(createPageApi(PAGE, fetchImpl).uploadAttachment(new Blob(["abc"]), "x.png")).resolves.toEqual(ref);
    const body = calls[0]?.init.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBeNull();
  });

  it("searchPeople GETs people with the query", async () => {
    const { calls, fetchImpl } = mockFetch(json(200, { people: [{ id: "u2", name: "Bob" }] }));
    await expect(createPageApi(PAGE, fetchImpl).searchPeople("Bo")).resolves.toEqual([{ id: "u2", name: "Bob" }]);
    expect(calls[0]?.url).toBe("/api/v1/spaces/TEAM/people?q=Bo");
  });
});

const CODES: ReadonlyArray<[ApiErrorCode, number, Record<string, unknown>]> = [
  ["UNAUTHENTICATED", 401, {}],
  ["ORIGIN_MISMATCH", 403, {}],
  ["FORBIDDEN", 403, {}],
  ["NOT_FOUND", 404, {}],
  ["VALIDATION", 422, { errors: [{ path: "content.0", message: "bad" }] }],
  ["TITLE_TAKEN", 409, {}],
  ["VERSION_CONFLICT", 409, { currentVersion: 7 }],
  ["CYCLE", 409, {}],
  ["CURRENT_VERSION", 409, {}],
  ["PINNED_VERSION", 409, {}],
  ["TOO_LARGE", 413, { limit: 5242880 }],
  ["UNSUPPORTED_MEDIA", 415, {}],
  ["RENDER_UNSUPPORTED", 500, {}],
  ["INTERNAL", 500, {}],
];

describe("problem+json errors (08 §3.2)", () => {
  it.each(CODES)("%s (%i) becomes an ApiError with that code, status and extras", async (code, status, extras) => {
    const { fetchImpl } = mockFetch(problem(status, code, extras));
    const error = await createPageApi(PAGE, fetchImpl)
      .publish(PUBLISH)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(AppError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe(code);
    expect(apiError.status).toBe(status);
    expect(apiError.errors).toEqual(code === "VALIDATION" ? [{ path: "content.0", message: "bad" }] : []);
    expect(apiError.currentVersion).toBe(code === "VERSION_CONFLICT" ? 7 : null);
    expect(apiError.limit).toBe(code === "TOO_LARGE" ? 5242880 : null);
  });

  it("an unknown code or a non-JSON error page is UNEXPECTED_RESPONSE with the status", async () => {
    const { fetchImpl } = mockFetch(problem(418, "TEAPOT"), new Response("<html>Bad gateway</html>", { status: 502 }));
    const api = createPageApi(PAGE, fetchImpl);
    const first = await api.saveDraft(DRAFT).catch((e: unknown) => e);
    const second = await api.saveDraft(DRAFT).catch((e: unknown) => e);
    expect(first).toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 418 });
    expect(second).toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 502 });
  });

  it("malformed extras are dropped, not trusted", () => {
    const error = problemToError(409, { code: "VERSION_CONFLICT", currentVersion: "7", errors: [{ path: 1 }], limit: Infinity });
    expect(error.currentVersion).toBeNull();
    expect(error.errors).toEqual([]);
    expect(error.limit).toBeNull();
  });

  it("a success body of the wrong shape is UNEXPECTED_RESPONSE", async () => {
    const { fetchImpl } = mockFetch(json(200, { saved: true }), new Response("not json", { status: 200 }));
    const api = createPageApi(PAGE, fetchImpl);
    await expect(api.saveDraft(DRAFT)).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE" });
    await expect(api.saveDraft(DRAFT)).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE" });
  });
});

describe("network failures", () => {
  it("a rejected fetch is NETWORK with status 0", async () => {
    const { fetchImpl } = mockFetch(new TypeError("Failed to fetch"));
    await expect(createPageApi(PAGE, fetchImpl).saveDraft(DRAFT)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("an aborted fetch is ABORTED", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const { fetchImpl } = mockFetch(abort);
    await expect(createPageApi(PAGE, fetchImpl).heartbeat()).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("toApiError passes an ApiError through and wraps anything else", () => {
    const original = new ApiError("NETWORK", 0);
    expect(toApiError(original)).toBe(original);
    expect(toApiError(new Error("boom"))).toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 0 });
    expect(toApiError("string")).toMatchObject({ code: "UNEXPECTED_RESPONSE" });
  });
});

describe("which autosave failures are retried", () => {
  it.each([
    ["NETWORK", 0, true],
    ["INTERNAL", 500, true],
    ["UNAUTHENTICATED", 401, true],
    ["UNEXPECTED_RESPONSE", 502, true],
    ["UNEXPECTED_RESPONSE", 429, true],
    ["UNEXPECTED_RESPONSE", 0, true],
    ["UNEXPECTED_RESPONSE", 200, false],
    ["UNEXPECTED_RESPONSE", 418, false],
    ["VALIDATION", 422, false],
    ["TOO_LARGE", 413, false],
    ["FORBIDDEN", 403, false],
    ["NOT_FOUND", 404, false],
    ["ORIGIN_MISMATCH", 403, false],
    ["ABORTED", 0, false],
  ] as const)("%s (%i) → retry %s", (code, status, expected) => {
    expect(isRetryable(new ApiError(code, status))).toBe(expected);
  });
});
