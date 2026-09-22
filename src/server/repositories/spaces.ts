import type { Space, SpacePermission } from '@prisma/client';
import { prisma } from './client';

export type SpaceWithPermissions = { space: Space; permissions: SpacePermission[] };

async function groupIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  return rows.map((r) => r.groupId);
}

/**
 * Effective space permissions = the union of every membership that matches the user
 * directly or through one of their groups.
 * spec: 07-permissions-and-limits.md §2.1
 */
export async function effectivePermissions(userId: string, spaceId: string): Promise<SpacePermission[]> {
  const groupIds = await groupIdsOf(userId);
  const memberships = await prisma.membership.findMany({
    where: { spaceId, OR: [{ userId }, { groupId: { in: groupIds } }] },
    select: { permissions: true },
  });
  return [...new Set(memberships.flatMap((m) => m.permissions))];
}

/** Spaces the user can see at all, i.e. those granting VIEW. */
export async function listSpacesForUser(userId: string): Promise<SpaceWithPermissions[]> {
  const groupIds = await groupIdsOf(userId);
  const spaces = await prisma.space.findMany({
    where: { memberships: { some: { OR: [{ userId }, { groupId: { in: groupIds } }] } } },
    orderBy: { key: 'asc' },
    include: {
      memberships: {
        where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
        select: { permissions: true },
      },
    },
  });

  return spaces
    .map(({ memberships, ...space }) => ({
      space: space as Space,
      permissions: [...new Set(memberships.flatMap((m) => m.permissions))],
    }))
    .filter((entry) => entry.permissions.includes('VIEW'));
}

export async function spaceKeysByIds(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.space.findMany({ where: { id: { in: [...ids] } }, select: { id: true, key: true } });
  return new Map(rows.map((row) => [row.id, row.key]));
}

export async function findSpaceByKey(key: string): Promise<Space | null> {
  return prisma.space.findUnique({ where: { key } });
}

export async function countRequirements(spaceId: string): Promise<number> {
  return prisma.requirement.count({ where: { spaceId, baselineId: null, status: 'ACTIVE' } });
}

export async function countDocuments(spaceId: string): Promise<number> {
  return prisma.document.count({ where: { spaceId, deletedAt: null } });
}

/** By id, for the job runner, which carries an id rather than a key. */
export async function findSpaceById(id: string): Promise<Space | null> {
  return prisma.space.findUnique({ where: { id } });
}
