// Use case: sign in with email + password (RD-050).
import { z } from "zod";
import type { LoginThrottle } from "@/domain/auth/login-throttle";
import { InvalidCredentialsError, ThrottledError } from "@/domain/errors";
import { MAX_PASSWORD_LENGTH, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { SESSION_TTL_MS, generateSessionToken, hashSessionToken } from "@/server/auth/session-token";
import { loginThrottle } from "@/server/auth/throttle";
import { createSession } from "@/server/repositories/sessions";
import { findUserByEmail } from "@/server/repositories/users";

const credentials = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export interface LoginResult {
  /** The raw token for the cookie. Only its hash is stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface LoginDeps {
  readonly throttle: LoginThrottle;
  readonly now: () => Date;
}

const defaultDeps: LoginDeps = { throttle: loginThrottle, now: () => new Date() };

export async function login(input: unknown, deps: LoginDeps = defaultDeps): Promise<LoginResult> {
  const parsed = credentials.safeParse(input);
  // Malformed input is indistinguishable from a wrong password: no format hints to probe with.
  if (!parsed.success) throw new InvalidCredentialsError();
  const { email, password } = parsed.data;

  const wait = deps.throttle.retryAfterSeconds(email);
  if (wait > 0) throw new ThrottledError(wait);

  const user = await findUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
  if (!user || !ok) {
    deps.throttle.recordFailure(email);
    throw new InvalidCredentialsError();
  }

  deps.throttle.reset(email);
  const token = generateSessionToken();
  const expiresAt = new Date(deps.now().getTime() + SESSION_TTL_MS);
  await createSession({ tokenHash: hashSessionToken(token), userId: user.id, expiresAt });
  return { token, expiresAt };
}
