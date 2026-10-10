// Authentication for route handlers (spec 08 §1 and §3, RD-064). The session cookie is read
// from the Request's own Cookie header rather than from next/headers, so a handler can be
// exercised in a test with nothing more than `new Request(...)`.
import { SESSION_COOKIE } from "@/server/auth/cookie-name";
import { resolveSession } from "@/server/usecases/session";
import type { Actor } from "./actor";

/** Session tokens are 43 base64url characters (RD-050); anything far longer is not one. */
const MAX_TOKEN_LENGTH = 512;

/**
 * The value of the `rf_session` cookie in a Cookie header, or undefined. When the header names
 * the cookie more than once (a browser sends the most specific path first), the first wins.
 * A value wrapped in double quotes is unwrapped; percent-encoding is decoded when it is valid.
 */
// spec: docs/specs/09-decision-log.md section RD-050 (server-side sessions); RD-064 (session cookie only)
export function sessionTokenFromCookieHeader(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Not valid percent-encoding: use it as written; it simply will not match a session.
    }
    if (value === "" || value.length > MAX_TOKEN_LENGTH) return undefined;
    return value;
  }
  return undefined;
}

/** The signed-in user a request's session cookie belongs to, or null (missing, unknown or expired). */
// spec: docs/specs/08-api-surface.md section 3.2 (UNAUTHENTICATED); RD-064
export async function userFromRequest(request: Request): Promise<Actor | null> {
  return resolveSession(sessionTokenFromCookieHeader(request.headers.get("cookie")));
}
