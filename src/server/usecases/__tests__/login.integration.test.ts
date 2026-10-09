import { beforeEach, describe, expect, it } from "vitest";
import { LoginThrottle } from "@/domain/auth/login-throttle";
import { InvalidCredentialsError, ThrottledError } from "@/domain/errors";
import { hashSessionToken } from "@/server/auth/session-token";
import { login } from "@/server/usecases/login";
import { logout, resolveSession } from "@/server/usecases/session";
import { DEMO, TEST_PASSWORD, prisma, resetDemoInstance } from "@/test-support/fixtures";

const ALICE = DEMO.users.alice.email;

function deps(overrides: { now?: Date; maxFailures?: number } = {}) {
  const clock = { at: overrides.now ?? new Date("2026-10-09T09:00:00Z") };
  return {
    clock,
    throttle: new LoginThrottle({ maxFailures: overrides.maxFailures ?? 3, now: () => clock.at.getTime() }),
    now: () => clock.at,
  };
}

beforeEach(resetDemoInstance);

describe("login", () => {
  it("signs in with the right password and returns a token for the cookie", async () => {
    const result = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt.toISOString()).toBe("2026-10-23T09:00:00.000Z"); // 14 days
  });

  it("stores only the hash of the token", async () => {
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("is case- and whitespace-insensitive about the email", async () => {
    await expect(login({ email: `  ${ALICE.toUpperCase()} `, password: TEST_PASSWORD }, deps())).resolves.toBeDefined();
  });

  it("refuses a wrong password", async () => {
    await expect(login({ email: ALICE, password: "nope" }, deps())).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(await prisma.session.count()).toBe(0);
  });

  it("answers an unknown email exactly like a wrong password", async () => {
    const wrongPassword = await login({ email: ALICE, password: "nope" }, deps()).catch((e: unknown) => e);
    const unknownEmail = await login({ email: "nobody@reqforge.test", password: "nope" }, deps()).catch((e: unknown) => e);
    expect(unknownEmail).toBeInstanceOf(InvalidCredentialsError);
    expect((unknownEmail as Error).message).toBe((wrongPassword as Error).message);
  });

  it.each([
    ["missing fields", {}],
    ["non-string password", { email: ALICE, password: 12345 }],
    ["empty password", { email: ALICE, password: "" }],
    ["over-long password", { email: ALICE, password: "x".repeat(5000) }],
    ["null", null],
  ])("treats malformed input (%s) as invalid credentials", async (_label, input) => {
    await expect(login(input, deps())).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("throttles an email after repeated failures — even for the right password", async () => {
    const d = deps({ maxFailures: 3 });
    for (let i = 0; i < 3; i++) await login({ email: ALICE, password: "nope" }, d).catch(() => undefined);
    const blocked = await login({ email: ALICE, password: TEST_PASSWORD }, d).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(ThrottledError);
    expect((blocked as ThrottledError).retryAfterSeconds).toBeGreaterThan(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("throttling one email does not block another", async () => {
    const d = deps({ maxFailures: 2 });
    for (let i = 0; i < 2; i++) await login({ email: ALICE, password: "nope" }, d).catch(() => undefined);
    await expect(login({ email: DEMO.users.bob.email, password: TEST_PASSWORD }, d)).resolves.toBeDefined();
  });

  it("a successful sign-in clears earlier failures", async () => {
    const d = deps({ maxFailures: 3 });
    await login({ email: ALICE, password: "nope" }, d).catch(() => undefined);
    await login({ email: ALICE, password: "nope" }, d).catch(() => undefined);
    await login({ email: ALICE, password: TEST_PASSWORD }, d);
    await login({ email: ALICE, password: "nope" }, d).catch(() => undefined);
    await expect(login({ email: ALICE, password: TEST_PASSWORD }, d)).resolves.toBeDefined();
  });
});

describe("sessions", () => {
  it("resolves a token to its user, without the password hash", async () => {
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    const actor = await resolveSession(token);
    expect(actor).toMatchObject({ email: ALICE, isInstanceAdmin: true });
    expect(actor).not.toHaveProperty("passwordHash");
  });

  it("does not resolve a missing, unknown or tampered token", async () => {
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession("")).toBeNull();
    expect(await resolveSession("not-a-token")).toBeNull();
    expect(await resolveSession(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
  });

  it("expires after its lifetime and deletes the stale row", async () => {
    const d = deps();
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, d);
    const fifteenDaysLater = new Date(d.clock.at.getTime() + 15 * 24 * 3600 * 1000);
    expect(await resolveSession(token, () => fifteenDaysLater)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("is still valid just before it expires", async () => {
    const d = deps();
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, d);
    const justBefore = new Date(d.clock.at.getTime() + 14 * 24 * 3600 * 1000 - 1000);
    expect(await resolveSession(token, () => justBefore)).not.toBeNull();
  });

  it("logout ends the session, and ending it twice is fine", async () => {
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    await logout(token);
    expect(await resolveSession(token)).toBeNull();
    await expect(logout(token)).resolves.toBeUndefined();
    await expect(logout(undefined)).resolves.toBeUndefined();
  });

  it("logging out one session leaves the user's other sessions alone", async () => {
    const a = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    const b = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    await logout(a.token);
    expect(await resolveSession(b.token)).not.toBeNull();
  });

  it("deleting a user deletes their sessions", async () => {
    const { token } = await login({ email: ALICE, password: TEST_PASSWORD }, deps());
    await prisma.user.delete({ where: { email: ALICE } });
    expect(await resolveSession(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });
});
