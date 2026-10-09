// Session cookie values. The browser holds the random token; the database holds only its
// SHA-256, so a leaked database does not yield usable sessions (RD-050).
import { createHash, randomBytes } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export { SESSION_COOKIE } from "./cookie-name";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
