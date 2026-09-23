import { ConflictError, NotFoundError } from '@/domain/errors';
import { prisma } from './client';

/** Groups and their members — instance-wide, like the users in them. spec 07 §2; RD-061. */

export async function listGroups() {
  const groups = await prisma.group.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  const userIds = [...new Set(groups.flatMap((group) => group.members.map((member) => member.userId)))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((user) => [user.id, user]));
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    members: group.members
      .flatMap((member) => {
        const user = byId.get(member.userId);
        return user ? [user] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export async function createGroup(name: string) {
  try {
    return await prisma.group.create({ data: { name }, select: { id: true, name: true } });
  } catch {
    throw new ConflictError(`There is already a group called “${name}”.`);
  }
}

/**
 * Deleting a group removes its memberships and its restriction grants with it: a grant to
 * a group that no longer exists would admit nobody, and leaving the row behind would make
 * the restriction screen show a ghost.
 */
export async function deleteGroup(id: string) {
  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundError('That group no longer exists.');
    await tx.membership.deleteMany({ where: { groupId: id } });
    await tx.documentRestriction.deleteMany({ where: { groupId: id } });
    await tx.group.delete({ where: { id } });
  });
}

export async function addGroupMember(groupId: string, userId: string) {
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId },
    update: {},
  });
}

export async function removeGroupMember(groupId: string, userId: string) {
  await prisma.groupMember.deleteMany({ where: { groupId, userId } });
}

export async function findGroup(id: string) {
  return prisma.group.findUnique({ where: { id }, select: { id: true, name: true } });
}
