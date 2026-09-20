import type { Session, User } from '@prisma/client';
import { prisma } from './client';

export async function createSession(id: string, userId: string, expiresAt: Date): Promise<Session> {
  return prisma.session.create({ data: { id, userId, expiresAt } });
}

export async function findLiveSession(id: string): Promise<(Session & { user: User }) | null> {
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  return session;
}

export async function deleteSession(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}
