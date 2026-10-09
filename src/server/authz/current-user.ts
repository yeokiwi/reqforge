// Request-scoped authentication for server components, actions and route handlers.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/server/auth/session-token";
import { resolveSession } from "@/server/usecases/session";
import type { Actor } from "./actor";

/** The signed-in user, or null. Memoised for the duration of one request. */
export const currentUser = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

/**
 * Pages call this, not just layouts: a layout is not re-run on client-side navigation, so a
 * layout-only check would leave pages reachable after the session ends.
 */
export async function requireUser(): Promise<Actor> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Chromium treats http://localhost as a secure context, so this also works for local
    // production builds. Set REQFORGE_COOKIE_SECURE=0 to serve plain http on a LAN.
    secure: process.env.NODE_ENV === "production" && process.env.REQFORGE_COOKIE_SECURE !== "0",
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(Math.min(SESSION_TTL_MS, expiresAt.getTime() - Date.now()) / 1000),
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
