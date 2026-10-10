// Calls /api/v1 route handlers directly, the way Next does, with `new Request(...)`:
//
//   const token = await sessionFor("alice");
//   const res = await GET(apiRequest("GET", "/api/v1/spaces/TEAM/pages", { session: token }),
//                         routeContext({ spaceKey: "TEAM" }));
//
// Requests carry the session cookie, a Host header and — by default — a same-site Origin, so a
// test opts OUT of what a browser would send (`origin: null`, `session: null`) to probe a refusal.
import { expect } from "vitest";
import type { ApiErrorCode, ProblemDetails } from "@/domain/documents/api-types";
import { LoginThrottle } from "@/domain/auth/login-throttle";
import { SESSION_COOKIE } from "@/server/auth/cookie-name";
import { login } from "@/server/usecases/login";
import { DEMO, TEST_PASSWORD, type Handle } from "./fixtures";

export const TEST_HOST = "reqforge.test";
export const TEST_ORIGIN = `http://${TEST_HOST}`;

/** Signs a demo user in through the login use case and returns the raw session token. */
export async function sessionFor(handle: Handle): Promise<string> {
  const { token } = await login(
    { email: DEMO.users[handle].email, password: TEST_PASSWORD },
    { throttle: new LoginThrottle(), now: () => new Date() },
  );
  return token;
}

export interface RequestOptions {
  /** The session token for the Cookie header; null or omitted sends no cookie. */
  readonly session?: string | null;
  /** The Origin header. Default TEST_ORIGIN; null sends none. */
  readonly origin?: string | null;
  /** A JSON body (serialised, Content-Type application/json unless `contentType` says otherwise). */
  readonly json?: unknown;
  /** A raw body; use with `contentType`. A ReadableStream is sent chunked, with no Content-Length. */
  readonly body?: BodyInit;
  /** Overrides (or with null removes) the Content-Type header. */
  readonly contentType?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A Request for `path` on the test host, as a same-site browser would send it. */
export function apiRequest(method: string, path: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  headers.set("host", TEST_HOST);
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.session) headers.append("cookie", `${SESSION_COOKIE}=${options.session}`);

  let body: BodyInit | undefined = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers.set("content-type", "application/json");
  }
  if (options.contentType === null) headers.delete("content-type");
  else if (options.contentType !== undefined) headers.set("content-type", options.contentType);

  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (body !== undefined) {
    init.body = body;
    if (body instanceof ReadableStream) init.duplex = "half";
  }
  return new Request(`${TEST_ORIGIN}${path}`, init);
}

/** A multipart/form-data upload with one `file` field. */
export function uploadRequest(
  path: string,
  file: { readonly name: string; readonly type?: string; readonly bytes: Uint8Array },
  options: Omit<RequestOptions, "json" | "body" | "contentType"> & { readonly field?: string } = {},
): Request {
  const form = new FormData();
  form.append(options.field ?? "file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "" }));
  // Let Request serialise the form and set the multipart boundary itself.
  const prepared = apiRequest("POST", path, { ...options, contentType: null });
  return new Request(prepared, { body: form });
}

/** The second argument Next passes a route handler. */
export function routeContext<P>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

/** A Next 15 route handler as a route.ts exports it. */
export type RouteHandlerFn<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

/**
 * Calls an exported route handler the way Next would: `send(page.PUT, "PUT", url, { spaceKey, id }, { session, json })`.
 * A missing export (the route does not serve that method) fails the test loudly.
 */
export function send<P>(handler: RouteHandlerFn<P> | undefined, method: string, path: string, params: P, options: RequestOptions = {}): Promise<Response> {
  if (handler === undefined) throw new Error(`the route for ${path} exports no ${method} handler`);
  return handler(apiRequest(method, path, options), routeContext(params));
}

/** A ReadableStream that yields `total` bytes of `fill` in `chunk`-sized pieces — a chunked body with no Content-Length. */
export function streamOf(total: number, chunk = 64 * 1024, fill = 0x20): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const n = Math.min(chunk, total - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(fill));
    },
  });
}

/** Asserts the response is problem+json and returns the body. */
export async function readProblem(response: Response): Promise<ProblemDetails> {
  const type = response.headers.get("content-type");
  if (type !== "application/problem+json") {
    throw new Error(`expected application/problem+json, got ${type ?? "no Content-Type"} (status ${response.status})`);
  }
  return (await response.json()) as ProblemDetails;
}

/**
 * Asserts the whole problem+json contract of spec 08 §3.2 — status, media type, no-store, no
 * redirect, `type`, `title`, `detail`, `status` and the stable `code` — and returns the body.
 */
export async function expectProblem(response: Response, status: number, code: ApiErrorCode): Promise<ProblemDetails> {
  expect(response.status, `status for ${code}`).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("location")).toBeNull();
  const problem = await readProblem(response);
  expect(problem).toMatchObject({ type: "about:blank", status, code });
  expect(typeof problem.title).toBe("string");
  expect(typeof problem.detail).toBe("string");
  return problem;
}

/** The JSON body of a successful response. */
export async function readJson<T>(response: Response): Promise<T> {
  if (response.status >= 400) {
    throw new Error(`expected success, got ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}
