// Where to send someone after signing in. The target comes from a query string, i.e. from
// an attacker, so only same-site relative paths survive (open-redirect protection).

export const DEFAULT_LANDING = "/";

export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_LANDING;
  // Must be a path on this origin: one leading slash, not "//host" or "/\host".
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_LANDING;
  // Control characters (CR/LF/tab) can smuggle a different URL past naive checks.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_LANDING;
  // A backslash anywhere is treated as "/" by some browsers.
  if (raw.includes("\\")) return DEFAULT_LANDING;
  // Never bounce back to the sign-in page itself.
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return DEFAULT_LANDING;
  return raw;
}
