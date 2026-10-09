import { prisma } from "./client";

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly isInstanceAdmin: boolean;
  readonly sidebarCollapsed: boolean;
}

const select = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  isInstanceAdmin: true,
  sidebarCollapsed: true,
} as const;

/** `email` must already be trimmed and lower-cased (the column has a CHECK for it). */
export function findUserByEmail(email: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { email }, select });
}

export function findUserById(id: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { id }, select });
}

export async function setSidebarCollapsed(userId: string, collapsed: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sidebarCollapsed: collapsed } });
}
