// A fast first gate: no session cookie → /login. This only checks that a cookie is present.
// It is NOT the authorisation check — every page and action validates the session against the
// database (requireUser), because a cookie's presence proves nothing about its validity.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie-name";

export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  const target = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  if (target !== "/") url.searchParams.set("next", target);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the sign-in page, the health probe and Next's own assets.
  matcher: ["/((?!login$|login/|api/health$|_next/|favicon\\.ico$).*)"],
};
