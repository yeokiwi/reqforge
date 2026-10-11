import { describe, expect, it, vi } from "vitest";
import { ApiError, callApi, spaceUrls, type FetchLike } from "../api-client";

const respond = (status: number, body?: unknown) =>
  vi.fn<FetchLike>(() => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })));

describe("spaceUrls", () => {
  it("percent-encodes every segment", () => {
    const urls = spaceUrls("A B");
    expect(urls.pages).toBe("/api/v1/spaces/A%20B/pages");
    expect(urls.move("x/y")).toBe("/api/v1/spaces/A%20B/pages/x%2Fy/move");
    expect(urls.restore("p", 3)).toBe("/api/v1/spaces/A%20B/pages/p/versions/3/restore");
  });
});

describe("callApi", () => {
  it("sends JSON with the cookie and parses the answer", async () => {
    const fetchImpl = respond(201, { id: "p1" });
    const result = await callApi("POST", "/x", { a: 1 }, fetchImpl);
    expect(result).toEqual({ id: "p1" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/x",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: '{"a":1}' }),
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("sends no body and no Content-Type when there is none, and returns null for a 204", async () => {
    const fetchImpl = respond(204);
    expect(await callApi("DELETE", "/x", undefined, fetchImpl)).toBeNull();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("lets the browser set the multipart boundary", async () => {
    const fetchImpl = respond(201, {});
    await callApi("POST", "/x", new FormData(), fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("turns a problem+json answer into an ApiError with its code and extras", async () => {
    const fetchImpl = respond(413, { code: "TOO_LARGE", limit: 52_428_800, detail: "d" });
    const error = await callApi("POST", "/x", {}, fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "TOO_LARGE", status: 413, limit: 52_428_800 });
  });

  it("is UNEXPECTED_RESPONSE for an error without a problem body, and NETWORK when fetch rejects", async () => {
    const unexpected = await callApi("GET", "/x", undefined, respond(502)).catch((e: unknown) => e);
    expect(unexpected).toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 502 });
    const offline = await callApi("GET", "/x", undefined, () => Promise.reject(new TypeError("Failed to fetch"))).catch(
      (e: unknown) => e,
    );
    expect(offline).toMatchObject({ code: "NETWORK", status: 0 });
    const aborted = await callApi("GET", "/x", undefined, () => Promise.reject(new DOMException("x", "AbortError"))).catch(
      (e: unknown) => e,
    );
    expect(aborted).toMatchObject({ code: "ABORTED", status: 0 });
  });
});
