// A fast first gate: no session cookie → /login, or, for the API, a 401 problem response (an
// API client must never be redirected to a sign-in page, RD-064). This only checks that a
// cookie is present. It is NOT the authorisation check — every page, action and route handler
// validates the session against the database, because a cookie's presence proves nothing.
//
// Runs on the Edge runtime: import nothing that pulls in node:crypto or Prisma.
import { NextResponse, type NextRequest } from "next/server";
import { problemFor, problemJson } from "@/app/api/v1/_lib/problem";
import { SESSION_COOKIE } from "@/server/auth/cookie-name";

/** API paths answer 401 problem+json instead of redirecting. The health probe is public. */
// spec: docs/specs/08-api-surface.md sections 1 (GET /api/health is unauthenticated) and 3.2 (UNAUTHENTICATED: never a redirect on /api paths); RD-064
function isApiPath(pathname: string): boolean {
  return (pathname === "/api" || pathname.startsWith("/api/")) && pathname !== "/api/health";
}

// spec: docs/specs/08-api-surface.md section 3.2 (UNAUTHENTICATED); docs/specs/09-decision-log.md section RD-064
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (isApiPath(request.nextUrl.pathname)) return problemJson(problemFor("UNAUTHENTICATED"));

  const url = request.nextUrl.clone();
  const target = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  if (target !== "/") url.searchParams.set("next", target);
  return NextResponse.redirect(url);
}

// Everything except the sign-in page, the health probe and Next's own assets — and only requests
// WITHOUT a session cookie, the only ones this function acts on. A request with one does not run
// the middleware at all, and that matters: to hand a body to middleware Next copies it, and past
// `middlewareClientMaxBodySize` (10 MiB) the route handler then reads a TRUNCATED body — which a
// 10 MiB attachment with its multipart framing (RD-058) or an ASCII-escaped JSON body under
// JSON_BODY_CAP (RD-063) would be. Next reads this object statically at build time: literals
// only. "rf_session" is SESSION_COOKIE (middleware.test.ts checks it through Next's matcher).
// spec: docs/specs/08-api-surface.md sections 1 and 3.2; docs/specs/09-decision-log.md sections RD-058, RD-063, RD-064
export const config = {
  matcher: [
    {
      source: "/((?!login$|login/|api/health$|_next/|favicon\\.ico$).*)",
      missing: [{ type: "cookie", key: "rf_session" }],
    },
  ],
};
