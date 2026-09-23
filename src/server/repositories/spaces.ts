import type { Space, SpacePermission } from '@prisma/client';
import { prisma } from './client';
import { param, render, sql, substituteAlias } from '@/domain/ryql/sql';
import { documentVisibility, requirementVisibility, type Viewer } from './visibility';

export type SpaceWithPermissions = {
  space: Space;
  permissions: SpacePermission[];
  /** spec 07 §2.3 — shown beside the space everywhere it is listed. */
  classification: string | null;
};

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
      classification: { select: { name: true } },
    },
  });

  return spaces
    .map(({ memberships, classification, ...space }) => ({
      space: space as Space,
      permissions: [...new Set(memberships.flatMap((m) => m.permissions))],
      classification: classification?.name ?? null,
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

/** Rule X2 — "result counts reflect only what the caller can see". */
export async function countRequirements(viewer: Viewer, spaceId: string): Promise<number> {
  const { text, params } = render(sql`
    SELECT count(*)::int AS n FROM "Requirement" r
     WHERE r."spaceId" = ${param(spaceId)} AND r."baselineId" IS NULL AND r.status = 'ACTIVE'
       AND (${substituteAlias(requirementVisibility(viewer), 'r')})
  `);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(text, ...params);
  return rows[0]?.n ?? 0;
}

export async function countDocuments(viewer: Viewer, spaceId: string): Promise<number> {
  const { text, params } = render(sql`
    SELECT count(*)::int AS n FROM "Document" d
     WHERE d."spaceId" = ${param(spaceId)} AND d."deletedAt" IS NULL
       AND (${substituteAlias(documentVisibility(viewer), 'd')})
  `);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(text, ...params);
  return rows[0]?.n ?? 0;
}

/** By id, for the job runner, which carries an id rather than a key. */
export async function findSpaceById(id: string): Promise<Space | null> {
  return prisma.space.findUnique({ where: { id } });
}

export async function setHistorySettings(
  spaceId: string,
  input: { enabled: boolean; retentionDays: number | null },
): Promise<void> {
  await prisma.space.update({
    where: { id: spaceId },
    data: { historyEnabled: input.enabled, historyRetentionDays: input.retentionDays },
  });
}
