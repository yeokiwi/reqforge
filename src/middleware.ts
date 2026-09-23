import { NextResponse, type NextRequest } from 'next/server';

/**
 * Fast path only: an unauthenticated request never reaches a page that would throw
 * `AuthenticationError`. The cookie's signature is still verified server-side in
 * `src/server/auth/session.ts` — presence here proves nothing.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('reqforge_session');
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/spaces/:path*', '/s/:path*', '/settings/:path*'],
};
