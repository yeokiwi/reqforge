// The wrapper every /api/v1 route handler goes through (spec 08 §1 and §3, RD-064):
//   1. a state-changing method must carry an Origin naming this host (CSRF defence on top of
//      SameSite=Lax, because the session cookie is ambient) — else 403 ORIGIN_MISMATCH;
//   2. the caller is authenticated from the request's own Cookie header — else 401
//      UNAUTHENTICATED, never a redirect;
//   3. anything thrown becomes an RFC 9457 problem response.
// The Origin check runs first: a cross-site write is refused before any database work.
import { AppError, UnauthenticatedError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { userFromRequest } from "@/server/authz/request-user";
import { problemResponse } from "./problem";

/** A state-changing request whose Origin is missing or not this host. 403. */
// spec: docs/specs/08-api-surface.md section 3.2 (ORIGIN_MISMATCH); RD-064
export class OriginMismatchError extends AppError {
  constructor() {
    super("ORIGIN_MISMATCH", "The request's Origin does not match this host");
  }
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Origins from REQFORGE_TRUSTED_ORIGINS (comma-separated), normalised to `scheme://host[:port]`. */
export function trustedOrigins(raw: string | undefined = process.env.REQFORGE_TRUSTED_ORIGINS): ReadonlySet<string> {
  const out = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    try {
      const origin = new URL(trimmed).origin;
      if (origin !== "null") out.add(origin.toLowerCase());
    } catch {
      // Not a URL: ignored rather than trusted.
    }
  }
  return out;
}

/**
 * Whether a request's Origin header names this host (the request's Host header, compared with
 * the default port of the Origin's scheme removed) or a trusted origin. A missing Origin, the
 * opaque origin `null`, anything that is not http(s), and an http Origin for an https site are refused.
 */
// spec: docs/specs/09-decision-log.md section RD-064 (every state-changing request must carry an Origin that matches the host)
export function originAllowed(request: Request, trusted: ReadonlySet<string> = trustedOrigins()): boolean {
  const header = request.headers.get("origin");
  if (header === null || header === "" || header === "null") return false;
  let origin: URL;
  try {
    origin = new URL(header);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
  if (trusted.has(origin.origin.toLowerCase())) return true;
  // A plain-http page on the same host is a downgrade, and anyone on the network can serve one:
  // refuse it whenever the site is https (the request itself, or a proxy's X-Forwarded-Proto, says
  // so) or is a secure deployment on a real host (Secure cookie, not localhost) (RD-085).
  if (origin.protocol === "http:" && siteIsHttps(request, origin)) return false;
  const hostHeader = request.headers.get("host") ?? new URL(request.url).host;
  let host: string;
  try {
    host = new URL(`${origin.protocol}//${hostHeader}`).host;
  } catch {
    return false;
  }
  return host !== "" && host.toLowerCase() === origin.host.toLowerCase();
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/** Whether this deployment is served over https, as far as the request shows (see originAllowed). */
function siteIsHttps(request: Request, origin: URL): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") return true;
  if (new URL(request.url).protocol === "https:") return true;
  const secureDeployment = process.env.NODE_ENV === "production" && process.env.REQFORGE_COOKIE_SECURE !== "0";
  return secureDeployment && !LOOPBACK.test(origin.hostname);
}

/** Whether the method changes state and therefore needs the Origin check. */
export function isStateChanging(method: string): boolean {
  return STATE_CHANGING.has(method.toUpperCase());
}

export interface ApiContext<P> {
  readonly request: Request;
  readonly actor: Actor;
  readonly params: P;
}

/** The second argument Next 15 passes to a route handler. */
export interface RouteContext<P> {
  readonly params: Promise<P>;
}

export type RouteHandler<P> = (request: Request, context: RouteContext<P>) => Promise<Response>;

/** Wraps a route handler with the Origin check, authentication and problem responses. */
// spec: docs/specs/08-api-surface.md sections 1 and 3.2; docs/specs/09-decision-log.md section RD-064
export function apiRoute<P>(handler: (context: ApiContext<P>) => Promise<Response>): RouteHandler<P> {
  return async (request, context) => {
    try {
      if (isStateChanging(request.method) && !originAllowed(request)) throw new OriginMismatchError();
      const actor = await userFromRequest(request);
      if (!actor) throw new UnauthenticatedError();
      return await handler({ request, actor, params: await context.params });
    } catch (error) {
      return problemResponse(error);
    }
  };
}
