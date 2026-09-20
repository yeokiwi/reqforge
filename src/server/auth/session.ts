import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { User } from '@prisma/client';
import { createSession, deleteSession, findLiveSession } from '@/server/repositories/sessions';

const COOKIE_NAME = 'reqforge_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error('SESSION_SECRET must be set to at least 16 characters (see .env.example).');
  }
  return value;
}

function sign(sessionId: string): string {
  return createHmac('sha256', secret()).update(sessionId).digest('base64url');
}

/** Cookie value is `<id>.<hmac>`; a tampered id fails before it ever reaches the database. */
function unseal(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const mac = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  return id;
}

export async function startSession(userId: string): Promise<void> {
  const id = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await createSession(id, userId, expiresAt);
  const jar = await cookies();
  jar.set(COOKIE_NAME, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const id = unseal(jar.get(COOKIE_NAME)?.value);
  if (id) await deleteSession(id);
  jar.delete(COOKIE_NAME);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const id = unseal(jar.get(COOKIE_NAME)?.value);
  if (!id) return null;
  const session = await findLiveSession(id);
  return session?.user ?? null;
}
