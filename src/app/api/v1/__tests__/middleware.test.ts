// src/middleware.ts (spec 08 §1 and §3.2, RD-064): with no session cookie, an /api path answers
// 401 problem+json — never a redirect to the sign-in page — while every other path still
// redirects. The middle of this file asks Next's own build-time analyser and request matcher WHEN
// the middleware runs (only without a session cookie, so Next never truncates a signed-in
// request's body). The middleware runs on the Edge runtime, so the last part walks its import
// graph and fails on anything that needs Node (node:crypto, Prisma, next/headers, …).
import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { builtinModules } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { getPageStaticInfo } from "next/dist/build/analysis/get-page-static-info";
import type { PAGE_TYPES } from "next/dist/lib/page-types";
import { getCloneableBody } from "next/dist/server/body-streams";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { SESSION_COOKIE } from "@/server/auth/cookie-name";
import { JSON_BODY_CAP, UPLOAD_BODY_CAP } from "../_lib/body";

const ORIGIN = "http://reqforge.test";

function request(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${pathname}`, { headers: cookie ? { cookie } : {} });
}

describe("middleware", () => {
  it.each(["/api/v1/spaces/TEAM/pages", "/api/v1/attachments/abc/x.png", "/api/v1/nope", "/api/other", "/api"])(
    "answers %s without a session cookie with 401 problem+json and no redirect",
    async (pathname) => {
      const res = middleware(request(pathname));
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toMatchObject({ type: "about:blank", status: 401, code: "UNAUTHENTICATED" });
    },
  );

  it("treats a POST to the API the same way", () => {
    const res = middleware(new NextRequest(`${ORIGIN}/api/v1/spaces/TEAM/pages`, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("passes a request with a session cookie through (the route handler validates it)", () => {
    for (const pathname of ["/api/v1/spaces/TEAM/pages", "/spaces/TEAM"]) {
      const res = middleware(request(pathname, "rf_session=anything"));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("still redirects a page request without a session to /login, remembering where it was going", () => {
    const res = middleware(request("/spaces/TEAM/pages/abc?version=2"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/spaces/TEAM/pages/abc?version=2");
  });

  it("redirects / to /login without a next parameter", () => {
    const res = middleware(request("/"));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.search).toBe("");
  });

  it("does not treat a path that merely starts with /api as the API", () => {
    expect(middleware(request("/apiary")).status).toBe(307);
  });

});

// ------------------------------------------------------------------------------ when Next runs it

const SRC = path.resolve(__dirname, "../../../..");
const MIB = 1024 * 1024;

/**
 * Whether Next would run the middleware for a request, decided by Next itself: its build-time
 * analysis of src/middleware.ts (so the config must be statically readable, as `next build` needs
 * it), then the matcher the server applies to each request.
 */
async function nextRunsMiddleware(): Promise<(pathname: string, cookie?: string) => boolean> {
  const info = await getPageStaticInfo({
    pageFilePath: path.join(SRC, "middleware.ts"),
    nextConfig: {},
    isDev: false,
    page: "/middleware",
    pageType: "root" as PAGE_TYPES, // PAGE_TYPES.ROOT: an ambient const enum, so its value is spelled out
  });
  const matchers = info.middleware?.matchers ?? [];
  expect(matchers.length).toBeGreaterThan(0);
  const match = getMiddlewareRouteMatcher(matchers);
  type MatchRequest = Parameters<typeof match>[1];
  return (pathname, cookie) => match(pathname, { headers: cookie === undefined ? {} : { cookie } } as unknown as MatchRequest, {});
}

describe("when Next runs the middleware", () => {
  it("runs it for pages and the API only when the request has no session cookie", async () => {
    const runs = await nextRunsMiddleware();
    for (const p of ["/", "/spaces/TEAM", "/api/v1/spaces/TEAM/pages", "/api/v1/attachments/a/b.png", "/api/healthz", "/api/other"]) {
      expect(runs(p), `${p} without a cookie`).toBe(true);
      expect(runs(p, "theme=dark"), `${p} with another cookie`).toBe(true);
      expect(runs(p, `${SESSION_COOKIE}=anything`), `${p} with a session cookie`).toBe(false);
      expect(runs(p, `theme=dark; ${SESSION_COOKIE}=anything`), `${p} with a session cookie among others`).toBe(false);
    }
  });

  it("never runs it for the sign-in page, the health probe or Next's assets", async () => {
    const runs = await nextRunsMiddleware();
    for (const p of ["/login", "/login/x", "/api/health", "/_next/static/x.js", "/favicon.ico"]) {
      expect(runs(p), p).toBe(false);
      expect(runs(p, `${SESSION_COOKIE}=anything`), p).toBe(false);
    }
  });

  it("must not run it for a signed-in request: Next would cut the request body at 10 MiB to copy it for the middleware", async () => {
    // Why the session cookie keeps the middleware out of the way. To hand a body to middleware,
    // Next copies it, and past middlewareClientMaxBodySize (10 MiB by default) it ends BOTH
    // copies: the route handler then reads a truncated body. A 10 MiB attachment in its multipart
    // framing (RD-058), or a JSON body of ASCII-escaped content near 5 MiB (RD-063), is over it.
    const total = 10 * MIB + 4096;
    function* chunks(): Generator<Buffer> {
      for (let sent = 0; sent < total; sent += 64 * 1024) yield Buffer.alloc(Math.min(64 * 1024, total - sent), 0x20);
    }
    const request = Readable.from(chunks()) as unknown as IncomingMessage;
    const body = getCloneableBody(request);
    body.cloneBodyStream().resume();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await body.finalize();
    warn.mockRestore();
    let read = 0;
    for await (const chunk of request as unknown as AsyncIterable<Buffer>) read += chunk.byteLength;
    expect(read).toBe(10 * MIB);
    expect(UPLOAD_BODY_CAP).toBeGreaterThan(10 * MIB);
    expect(JSON_BODY_CAP).toBeGreaterThan(10 * MIB);
  });
});

// ------------------------------------------------------------------------------ Edge safety

/** Bare imports the middleware graph may use. Everything else bare is refused. */
const ALLOWED_PACKAGES = new Set(["next/server"]);

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function resolveLocal(from: string, specifier: string): string {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next form
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${from}`);
}

/** Runtime imports only: `import type` / `export type` are erased and cannot pull code in. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const clause = m[3] ?? "";
    if (/^type\s/.test(clause)) continue;
    out.push(m[4] as string);
  }
  for (const m of text.matchAll(/(^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(m[2] as string);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g)) out.push((m[1] ?? m[2]) as string);
  return out;
}

function importGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith("@/") || spec.startsWith(".")) stack.push(resolveLocal(file, spec));
      else packages.add(spec);
    }
  }
  return { files: [...files].map((f) => path.relative(SRC, f).split(path.sep).join("/")).sort(), packages: [...packages].sort() };
}

describe("the middleware's import graph is Edge-safe", () => {
  const graph = importGraph(path.join(SRC, "middleware.ts"));

  it("reaches only the small, pure modules it is meant to", () => {
    expect(graph.files).toEqual(["app/api/v1/_lib/problem.ts", "domain/errors.ts", "middleware.ts", "server/auth/cookie-name.ts"]);
  });

  it("imports no Node built-in, no Prisma and no package other than next/server", () => {
    expect(graph.packages.filter((p) => NODE_BUILTINS.has(p))).toEqual([]);
    expect(graph.packages.filter((p) => !ALLOWED_PACKAGES.has(p))).toEqual([]);
  });

  it("the walker sees through to a forbidden import (it is not vacuous)", () => {
    const repositories = importGraph(path.join(SRC, "server/authz/request-user.ts"));
    expect(repositories.packages).toEqual(expect.arrayContaining(["node:crypto", "@prisma/client"]));
  });
});
