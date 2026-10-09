import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_LENGTH, hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { generateSessionToken, hashSessionToken } from "@/server/auth/session-token";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horsf", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts: the same password hashes differently each time", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("never stores the password", async () => {
    expect(await hashPassword("hunter2-hunter2")).not.toContain("hunter2");
  });

  it("uses a self-describing format so parameters can change later", async () => {
    expect(await hashPassword("x")).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("treats Unicode-equivalent passwords as equal (NFKC)", async () => {
    const stored = await hashPassword("café"); // é precomposed
    expect(await verifyPassword("café", stored)).toBe(true); // e + combining acute
  });

  it("returns false — not an exception — for malformed stored hashes", async () => {
    for (const bad of ["", "plaintext", "scrypt$1$2$3", "bcrypt$a$b$c$d$e", "scrypt$x$8$1$AAAA$AAAA", "scrypt$32768$8$1$$"]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  });

  it("refuses absurd cost parameters from a corrupted row instead of exhausting memory", async () => {
    expect(await verifyPassword("x", "scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toBe(false);
  });

  it("refuses over-long passwords before hashing", async () => {
    const long = "a".repeat(MAX_PASSWORD_LENGTH + 1);
    await expect(hashPassword(long)).rejects.toThrow(RangeError);
    expect(await verifyPassword(long, await hashPassword("short"))).toBe(false);
  });

  it("verifyAgainstDummy always answers false", async () => {
    expect(await verifyAgainstDummy("not-a-real-password")).toBe(false);
    expect(await verifyAgainstDummy("anything")).toBe(false);
  });
});

describe("session tokens", () => {
  it("are long, URL-safe and unique", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("are stored only as a hex SHA-256, which differs from the token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
  });
});
