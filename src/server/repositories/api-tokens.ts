import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@prisma/client';
import { parseTokenString, type ApiScope } from '@/domain/api-scopes';
import { NotFoundError } from '@/domain/errors';
import { prisma } from './client';

/**
 * API tokens. spec: 08-api-surface.md §1; RD-065.
 *
 * The secret is 32 random bytes, so a fast hash is the right one: a slow KDF defends a
 * low-entropy password against guessing, and there is nothing here to guess. The id part
 * of the token locates the row; the comparison of hashes is constant-time.
 */

function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export type TokenView = {
  id: string;
  name: string;
  scopes: string[];
  spaceKeys: string[];
  lastUsed: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

const VIEW = { id: true, name: true, scopes: true, spaceKeys: true, lastUsed: true, revokedAt: true, createdAt: true } as const;

/** Returns the plaintext once; it is never stored and cannot be shown again. */
export async function createApiToken(input: {
  userId: string;
  name: string;
  scopes: readonly ApiScope[];
  spaceKeys: readonly string[];
}): Promise<{ token: string; view: TokenView }> {
  const secret = randomBytes(32).toString('base64url');
  const row = await prisma.apiToken.create({
    data: {
      userId: input.userId,
      name: input.name,
      hash: hashOf(secret),
      scopes: [...input.scopes],
      spaceKeys: [...input.spaceKeys],
    },
    select: VIEW,
  });
  return { token: `rf_${row.id}_${secret}`, view: row };
}

export async function listApiTokens(userId: string): Promise<TokenView[]> {
  return prisma.apiToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: VIEW });
}

export async function revokeApiToken(userId: string, id: string): Promise<TokenView> {
  const updated = await prisma.apiToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count === 0) throw new NotFoundError('No live token with that id belongs to you.');
  return prisma.apiToken.findUniqueOrThrow({ where: { id }, select: VIEW });
}

const TOUCH_EVERY_MS = 60_000;

/**
 * The live token for a presented string, with its owner — or null for anything malformed,
 * unknown, revoked or wrong. `lastUsed` is written at most once a minute, so a busy CI job
 * does not turn every read into a write.
 */
export async function authenticateToken(raw: string): Promise<{
  user: User;
  tokenId: string;
  scopes: string[];
  spaceKeys: string[];
} | null> {
  const parsed = parseTokenString(raw);
  if (!parsed) return null;

  const row = await prisma.apiToken.findUnique({ where: { id: parsed.id }, include: { user: true } });
  if (!row || row.revokedAt) return null;

  const presented = Buffer.from(hashOf(parsed.secret), 'hex');
  const stored = Buffer.from(row.hash, 'hex');
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;

  if (!row.lastUsed || Date.now() - row.lastUsed.getTime() > TOUCH_EVERY_MS) {
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsed: new Date() } }).catch(() => undefined);
  }
  return { user: row.user, tokenId: row.id, scopes: row.scopes, spaceKeys: row.spaceKeys };
}
