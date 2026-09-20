import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { effectivePermissions, listSpacesForUser } from '../spaces';
import { hashPassword } from '@/server/auth/password';

/** spec: 07-permissions-and-limits.md §2.1 — effective permissions are a union. */
describe('space permissions', () => {
  const made: { users: string[]; spaces: string[]; groups: string[] } = { users: [], spaces: [], groups: [] };

  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { spaceId: { in: made.spaces } } });
    await prisma.space.deleteMany({ where: { id: { in: made.spaces } } });
    await prisma.groupMember.deleteMany({ where: { groupId: { in: made.groups } } });
    await prisma.group.deleteMany({ where: { id: { in: made.groups } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  });

  it('unions direct and group memberships, and hides spaces without VIEW', async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `perm-${stamp}@test`, name: 'Perm', passwordHash: await hashPassword('x') },
    });
    made.users.push(user.id);

    const group = await prisma.group.create({ data: { name: `reviewers-${stamp}` } });
    made.groups.push(group.id);
    await prisma.groupMember.create({ data: { groupId: group.id, userId: user.id } });

    const visible = await prisma.space.create({ data: { key: `TA${stamp % 100000}`, name: 'Visible' } });
    const hidden = await prisma.space.create({ data: { key: `TB${stamp % 100000}`, name: 'Hidden' } });
    made.spaces.push(visible.id, hidden.id);

    await prisma.membership.create({ data: { spaceId: visible.id, userId: user.id, permissions: ['VIEW'] } });
    await prisma.membership.create({ data: { spaceId: visible.id, groupId: group.id, permissions: ['EXPORT'] } });
    // A membership granting EDIT but not VIEW must not make the space listable.
    await prisma.membership.create({ data: { spaceId: hidden.id, userId: user.id, permissions: ['EDIT'] } });

    const permissions = await effectivePermissions(user.id, visible.id);
    expect([...permissions].sort()).toEqual(['EXPORT', 'VIEW']);

    const listed = await listSpacesForUser(user.id);
    expect(listed.map((entry) => entry.space.id)).toEqual([visible.id]);
  });
});
