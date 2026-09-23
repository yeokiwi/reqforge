import type { Prisma, SpacePermission } from '@prisma/client';
import { ConflictError } from '@/domain/errors';
import { recordAuditEventIn } from './audit';
import { prisma } from './client';

/**
 * Space permissions: who holds VIEW, EDIT, EXPORT and ADMIN in a space, directly or
 * through a group. spec: 07-permissions-and-limits.md §2.1; RD-061.
 *
 * `(spaceId, userId, groupId)` is unique, but Postgres lets two rows with a NULL in the
 * key coexist, so every write goes through find-then-update rather than `upsert`.
 */

export type MembershipRow = {
  id: string;
  userId: string | null;
  groupId: string | null;
  name: string;
  detail: string;
  permissions: SpacePermission[];
};

export async function listMemberships(spaceId: string): Promise<MembershipRow[]> {
  const rows = await prisma.membership.findMany({
    where: { spaceId },
    select: { id: true, userId: true, groupId: true, permissions: true, user: { select: { name: true, email: true } } },
  });
  const groupIds = rows.flatMap((row) => (row.groupId ? [row.groupId] : []));
  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  const groupById = new Map(groups.map((group) => [group.id, group]));

  return rows
    .map((row) => {
      const group = row.groupId ? groupById.get(row.groupId) : undefined;
      return {
        id: row.id,
        userId: row.userId,
        groupId: row.groupId,
        name: row.user?.name ?? group?.name ?? 'Unknown',
        detail: row.user ? row.user.email : `group · ${group?._count.members ?? 0} members`,
        permissions: row.permissions,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findMembership(
  tx: Prisma.TransactionClient,
  spaceId: string,
  subject: { userId: string | null; groupId: string | null },
) {
  return tx.membership.findFirst({ where: { spaceId, userId: subject.userId, groupId: subject.groupId } });
}

/**
 * Replaces one subject's permissions in a space; an empty list removes the row. Runs in
 * the caller's transaction so the last-ADMIN check and the write cannot interleave with
 * another administrator's change.
 */
export async function writeMembership(
  tx: Prisma.TransactionClient,
  spaceId: string,
  subject: { userId: string | null; groupId: string | null },
  permissions: readonly SpacePermission[],
): Promise<SpacePermission[] | null> {
  const existing = await findMembership(tx, spaceId, subject);
  if (permissions.length === 0) {
    if (existing) await tx.membership.delete({ where: { id: existing.id } });
    return existing?.permissions ?? null;
  }
  if (existing) {
    await tx.membership.update({ where: { id: existing.id }, data: { permissions: [...permissions] } });
  } else {
    await tx.membership.create({
      data: { spaceId, userId: subject.userId, groupId: subject.groupId, permissions: [...permissions] },
    });
  }
  return existing?.permissions ?? null;
}

/**
 * The people who would hold ADMIN in the space after a change: directly, or through a
 * group with at least one member. A group nobody belongs to administers nothing.
 */
export async function countEffectiveAdmins(tx: Prisma.TransactionClient, spaceId: string): Promise<number> {
  const rows = await tx.membership.findMany({
    where: { spaceId, permissions: { has: 'ADMIN' } },
    select: { userId: true, groupId: true },
  });
  const users = new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])));
  const groupIds = rows.flatMap((row) => (row.groupId ? [row.groupId] : []));
  if (groupIds.length > 0) {
    const members = await tx.groupMember.findMany({ where: { groupId: { in: groupIds } }, select: { userId: true } });
    for (const member of members) users.add(member.userId);
  }
  return users.size;
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, name: true, email: true } });
}

export async function findGroupByName(name: string) {
  return prisma.group.findUnique({ where: { name: name.trim() }, select: { id: true, name: true } });
}

/** People and groups a restriction or a grant may name, for the pickers. */
export async function listSubjects(spaceId: string) {
  const [members, groups] = await Promise.all([
    prisma.membership.findMany({
      where: { spaceId, userId: { not: null } },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.group.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return {
    users: members.flatMap((row) => (row.user ? [row.user] : [])).sort((a, b) => a.name.localeCompare(b.name)),
    groups,
  };
}

/**
 * Sets one subject's permissions and audits it, refusing a change that would leave the
 * space with no administrator (RD-061). Serializable, so two administrators demoting each
 * other at the same moment cannot both pass the check.
 */
export async function changeMembership(input: {
  spaceId: string;
  subject: { userId: string | null; groupId: string | null; label: string };
  permissions: readonly SpacePermission[];
  actorId: string;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const before = await writeMembership(tx, input.spaceId, input.subject, input.permissions);
      if ((await countEffectiveAdmins(tx, input.spaceId)) === 0) {
        throw new ConflictError('That would leave nobody who can administer this space.');
      }
      await recordAuditEventIn(tx, {
        actorId: input.actorId,
        spaceId: input.spaceId,
        objectType: 'Membership',
        objectId: input.subject.userId ?? input.subject.groupId ?? '-',
        operation: 'permission-change',
        parameters: { subject: input.subject.label, from: before ?? [], to: [...input.permissions] },
      });
    },
    { isolationLevel: 'Serializable' },
  );
}
