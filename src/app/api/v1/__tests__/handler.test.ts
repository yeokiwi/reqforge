// The route wrapper (spec 08 §1 and §3.2, RD-064), without a database. The session lookup is
// stubbed so the order of the gates can be observed: the Origin gate runs before anything
// touches the session store, authentication before the handler, and whatever the handler throws
// becomes a problem response.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError, VersionConflictError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { sessionTokenFromCookieHeader, userFromRequest } from "@/server/authz/request-user";
import type * as RequestUser from "@/server/authz/request-user";
import { apiRoute, isStateChanging, originAllowed, trustedOrigins } from "../_lib/handler";

vi.mock("@/server/authz/request-user", async (importOriginal) => {
  const real = await importOriginal<typeof RequestUser>();
  return { ...real, userFromRequest: vi.fn() };
});

const HOST = "reqforge.test";
const ACTOR: Actor = { id: "u1", email: "a@reqforge.test", name: "A", isInstanceAdmin: false, sidebarCollapsed: false };

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://${HOST}/api/v1/spaces/TEAM/pages`, { method, headers: { host: HOST, ...headers } });
}

const ctx = { params: Promise.resolve({ spaceKey: "TEAM" }) };
const lookup = vi.mocked(userFromRequest);

beforeEach(() => {
  // A session is "valid" when the cookie says so; nothing here needs a database.
  lookup.mockImplementation(async (r: Request) => (sessionTokenFromCookieHeader(r.headers.get("cookie")) === "valid" ? ACTOR : null));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  lookup.mockReset();
});

describe("originAllowed", () => {
  const none = new Set<string>();

  it.each([
    ["the same host over http", "http://reqforge.test", HOST],
    ["the same host over https (TLS ends at a proxy)", "https://reqforge.test", HOST],
    ["a different letter case", "http://ReqForge.TEST", HOST],
    ["a matching non-default port", "http://reqforge.test:3000", `${HOST}:3000`],
    ["an explicit default port on the Host header", "http://reqforge.test", `${HOST}:80`],
  ])("allows %s", (_label, origin, host) => {
    expect(originAllowed(new Request(`http://${HOST}/x`, { method: "POST", headers: { host, origin } }), none)).toBe(true);
  });

  it.each([
    ["no Origin", undefined],
    ["an empty Origin", ""],
    ["the opaque origin null", "null"],
    ["another site", "http://evil.example"],
    ["a subdomain", "http://evil.reqforge.test"],
    ["a suffix trick", "http://reqforge.test.evil.example"],
    ["another port", "http://reqforge.test:8080"],
    ["a non-http scheme", "file://reqforge.test"],
    ["an extension scheme", "chrome-extension://reqforge.test"],
    ["garbage", "not a url"],
    ["userinfo before the host", "http://reqforge.test@evil.example"],
  ])("refuses %s", (_label, origin) => {
    const headers: Record<string, string> = { host: HOST };
    if (origin !== undefined) headers.origin = origin;
    expect(originAllowed(new Request(`http://${HOST}/x`, { method: "POST", headers }), none)).toBe(false);
  });

  describe("an http page for an https site is a downgrade, refused (RD-085)", () => {
    const post = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers: { host: HOST, ...headers } });

    it("when the request arrived over https", () => {
      expect(originAllowed(post(`https://${HOST}/x`, { origin: `http://${HOST}` }), none)).toBe(false);
      expect(originAllowed(post(`https://${HOST}/x`, { origin: `https://${HOST}` }), none)).toBe(true);
    });

    it("when a proxy says it was https (X-Forwarded-Proto)", () => {
      expect(originAllowed(post(`http://${HOST}/x`, { origin: `http://${HOST}`, "x-forwarded-proto": "https" }), none)).toBe(false);
      expect(originAllowed(post(`http://${HOST}/x`, { origin: `https://${HOST}`, "x-forwarded-proto": "https, http" }), none)).toBe(true);
    });

    it("in a production deployment with Secure cookies on a real host, even without a proxy header", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(originAllowed(post(`http://${HOST}/x`, { origin: `http://${HOST}` }), none)).toBe(false);
      expect(originAllowed(post(`http://${HOST}/x`, { origin: `https://${HOST}` }), none)).toBe(true);
    });

    it("but not on localhost, which production builds are tried on, nor when cookies are not Secure", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(
        originAllowed(new Request("http://localhost:3100/x", { method: "POST", headers: { host: "localhost:3100", origin: "http://localhost:3100" } }), none),
      ).toBe(true);
      vi.stubEnv("REQFORGE_COOKIE_SECURE", "0");
      expect(originAllowed(post(`http://${HOST}/x`, { origin: `http://${HOST}` }), none)).toBe(true);
    });

    it("unless the http origin is listed as trusted", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(originAllowed(post(`http://${HOST}/x`, { origin: `http://${HOST}` }), new Set([`http://${HOST}`]))).toBe(true);
    });
  });

  it("allows an origin listed in REQFORGE_TRUSTED_ORIGINS, and only that one", () => {
    const trusted = trustedOrigins(" https://app.example.com , junk, , http://other.example:8443/path ");
    expect([...trusted].sort()).toEqual(["http://other.example:8443", "https://app.example.com"]);
    const from = (origin: string) => new Request(`http://${HOST}/x`, { method: "POST", headers: { host: HOST, origin } });
    expect(originAllowed(from("https://app.example.com"), trusted)).toBe(true);
    expect(originAllowed(from("http://app.example.com"), trusted)).toBe(false);
    expect(originAllowed(from("http://other.example:8443"), trusted)).toBe(true);
  });

  it("reads REQFORGE_TRUSTED_ORIGINS from the environment by default", () => {
    vi.stubEnv("REQFORGE_TRUSTED_ORIGINS", "https://proxy.example");
    const r = new Request(`http://${HOST}/x`, { method: "POST", headers: { host: HOST, origin: "https://proxy.example" } });
    expect(originAllowed(r)).toBe(true);
  });
});

describe("isStateChanging", () => {
  it("is true for POST, PUT, PATCH and DELETE only", () => {
    expect(["POST", "PUT", "PATCH", "DELETE", "post"].map(isStateChanging)).toEqual([true, true, true, true, true]);
    expect(["GET", "HEAD", "OPTIONS"].map(isStateChanging)).toEqual([false, false, false]);
  });
});

describe("apiRoute", () => {
  it("answers 401 UNAUTHENTICATED as problem+json, never a redirect, without a valid session", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    for (const cookie of [undefined, "rf_session=expired"]) {
      const res = await apiRoute(inner)(req("GET", cookie ? { cookie } : {}), ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED", status: 401, type: "about:blank" });
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses %s without an Origin: 403 ORIGIN_MISMATCH, before any session lookup", async (method) => {
    const inner = vi.fn(async () => new Response("ok"));
    const res = await apiRoute(inner)(req(method, { cookie: "rf_session=valid" }), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ORIGIN_MISMATCH", status: 403 });
    expect(lookup).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it("refuses a foreign Origin on a write that carries a valid session cookie (CSRF)", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const res = await apiRoute(inner)(req("POST", { cookie: "rf_session=valid", origin: "https://evil.example" }), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ORIGIN_MISMATCH" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("does not need an Origin for GET, and hands the handler the actor and the awaited params", async () => {
    const inner = vi.fn(async ({ actor, params }: { actor: Actor; params: { spaceKey: string } }) => Response.json({ who: actor.id, key: params.spaceKey }));
    const res = await apiRoute(inner)(req("GET", { cookie: "rf_session=valid", origin: "https://evil.example" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ who: "u1", key: "TEAM" });
  });

  it("lets a same-site write through", async () => {
    const res = await apiRoute(async () => new Response(null, { status: 204 }))(
      req("PUT", { cookie: "rf_session=valid", origin: `http://${HOST}` }),
      ctx,
    );
    expect(res.status).toBe(204);
  });

  it.each<[string, unknown, number, string]>([
    ["NotFoundError", new NotFoundError("Page"), 404, "NOT_FOUND"],
    ["ValidationError", new ValidationError([{ path: "title", message: "x" }]), 422, "VALIDATION"],
    ["VersionConflictError", new VersionConflictError(4), 409, "VERSION_CONFLICT"],
    ["a plain Error", new Error("SELECT secret FROM t"), 500, "INTERNAL"],
  ])("turns a thrown %s into a problem response", async (_label, thrown, status, code) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await apiRoute(async () => {
      throw thrown;
    })(req("GET", { cookie: "rf_session=valid" }), ctx);
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code, status });
    expect(text).not.toContain("SELECT");
  });

  it("turns a failing session lookup into a 500 that leaks nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lookup.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const res = await apiRoute(async () => new Response("ok"))(req("GET", { cookie: "rf_session=valid" }), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("ECONNREFUSED");
  });
});

describe("sessionTokenFromCookieHeader", () => {
  it.each<[string | null, string | undefined]>([
    [null, undefined],
    ["", undefined],
    ["rf_session=abc", "abc"],
    ["other=1; rf_session=abc; more=2", "abc"],
    [" rf_session = abc ", "abc"],
    ['rf_session="abc"', "abc"],
    ["rf_session=a%2Fb", "a/b"],
    ["rf_session=%E0%A4%A", "%E0%A4%A"],
    ["rf_session=first; rf_session=second", "first"],
    ["rf_session=", undefined],
    ["xrf_session=abc", undefined],
    [`rf_session=${"a".repeat(513)}`, undefined],
    ["rf_session", undefined],
  ])("%j → %j", (header, expected) => {
    expect(sessionTokenFromCookieHeader(header)).toBe(expected);
  });
});
