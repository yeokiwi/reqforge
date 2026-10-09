// Use cases: resolve a session cookie to a user, and end a session.
// Sessions have a fixed lifetime (SESSION_TTL_MS from sign-in). There is no sliding renewal:
// a server component cannot refresh the cookie, so extending only the database row would
// outlive the cookie that points at it.
import { toActor, type Actor } from "@/server/authz/actor";
import { hashSessionToken } from "@/server/auth/session-token";
import { deleteSessionByTokenHash, findSessionByTokenHash } from "@/server/repositories/sessions";

/** The user a session cookie belongs to, or null if it is missing, unknown or expired. */
export async function resolveSession(
  token: string | undefined,
  now: () => Date = () => new Date(),
): Promise<Actor | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await findSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (session.expiresAt <= now()) {
    await deleteSessionByTokenHash(tokenHash);
    return null;
  }
  return toActor(session.user);
}

export async function logout(token: string | undefined): Promise<void> {
  if (token) await deleteSessionByTokenHash(hashSessionToken(token));
}
