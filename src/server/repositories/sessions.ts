import { prisma } from "./client";
import type { UserRecord } from "./users";

export interface SessionRecord {
  readonly id: string;
  readonly expiresAt: Date;
  readonly user: UserRecord;
}

export async function createSession(input: {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.session.create({ data: input });
}

export function findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
  return prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
          isInstanceAdmin: true,
          sidebarCollapsed: true,
        },
      },
    },
  });
}

/** Idempotent: signing out twice is not an error. */
export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function deleteExpiredSessions(now: Date): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
