// Password hashing for email + password sign-in (RD-050).
// scrypt from node:crypto — memory-hard, and no native dependency to build in CI or Docker.
// Stored form: `scrypt$N$r$p$<salt b64>$<hash b64>`, so parameters can be raised later and old
// hashes still verify.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** Passwords longer than this are refused before hashing so they cannot be used to burn CPU. */
export const MAX_PASSWORD_LENGTH = 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number) {
  const options: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`password must be 1–${MAX_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** False — never throws — for a wrong password or a malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  // Reject parameters that would let a corrupted row exhaust memory.
  if (n > 2 ** 20 || r > 32 || p > 16) return false;

  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await derive(password, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same CPU as a real check. Sign-in calls this for an unknown email so response
 * time does not reveal which addresses have accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
  return false;
}
