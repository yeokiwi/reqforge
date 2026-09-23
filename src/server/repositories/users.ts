import type { User } from '@prisma/client';
import { prisma } from './client';

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/** For a job re-establishing the person who queued it. */
export async function findUserOrThrow(id: string): Promise<User> {
  const user = await findUserById(id);
  if (!user) throw new Error('The person who queued this job no longer exists.');
  return user;
}
