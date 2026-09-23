import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domain/errors';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { effectivePermissions } from '@/server/repositories/spaces';
import { viewerFor } from '@/server/repositories/visibility';

/**
 * Permission administration. spec: 07-permissions-and-limits.md §2.1 and §6; RD-061.
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
type Who = 'admin' | 'member' | 'newcomer' | 'instanceAdmin';
const ids: Record<Who, string> = { admin: '', member: '', newcomer: '', instanceAdmin: '' };
const emails: Record<Who, string> = { admin: '', member: '', newcomer: '', instanceAdmin: '' };
let actor: Who = 'admin';
let spaceId = '';
let spaceKey = '';

vi.mock('@/server/authz', () => ({
  requireSpace: async (_key: string, permission = 'VIEW') => {
    const userId = ids[actor];
    const permissions = await effectivePermissions(userId, spaceId);
    if (!permissions.includes('VIEW')) throw new NotFoundError('No such space.');
    if (!permissions.includes(permission as 'VIEW')) throw new ForbiddenError(`You need the ${permission} permission.`);
    return {
      user: { id: userId },
      space: await prisma.space.findUniqueOrThrow({ where: { id: spaceId } }),
      permissions,
      can: (candidate: string) => permissions.includes(candidate as 'VIEW'),
      viewer: await viewerFor(userId),
    };
  },
  requireInstanceAdmin: async (what = 'do that') => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ids[actor] } });
    if (!user.isAdmin) throw new ForbiddenError(`Only an instance administrator can ${what}.`);
    return user;
  },
}));

const { setPermissionsUseCase, listPermissionsUseCase } = await import('@/server/usecases/permissions');
const groups = await import('@/server/usecases/groups');

const as = <T>(who: Who, work: () => Promise<T>): Promise<T> => {
  actor = who;
  return work();
};

beforeAll(async () => {
  for (const who of Object.keys(ids) as Who[]) {
    emails[who] = `pa-${who.toLowerCase()}-${tag}@test`;
    ids[who] = (
      await prisma.user.create({
        data: { email: emails[who], name: who, passwordHash: await hashPassword('x'), isAdmin: who === 'instanceAdmin' },
      })
    ).id;
  }
  spaceKey = `PA${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Permissions' } })).id;
  await prisma.membership.createMany({
    data: [
      { spaceId, userId: ids.admin, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
      { spaceId, userId: ids.member, permissions: ['VIEW'] },
    ],
  });
}, 120_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { OR: [{ spaceId }, { actorId: { in: Object.values(ids) } }] } });
  await prisma.membership.deleteMany({ where: { spaceId } });
  await prisma.group.deleteMany({ where: { name: { startsWith: `pa-${tag}` } } });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

describe('space permissions (RD-061)', () => {
  it('grants to a person by email, and any permission implies VIEW', async () => {
    const granted = await as('admin', () => setPermissionsUseCase(spaceKey, { email: emails.newcomer, permissions: ['EDIT'] }));
    expect(granted).toEqual(['VIEW', 'EDIT']);
    expect(await effectivePermissions(ids.newcomer, spaceId)).toEqual(expect.arrayContaining(['VIEW', 'EDIT']));
  });

  it('revokes everything with an empty set', async () => {
    await as('admin', () => setPermissionsUseCase(spaceKey, { email: emails.newcomer, permissions: [] }));
    expect(await effectivePermissions(ids.newcomer, spaceId)).toEqual([]);
  });

  it('refuses to leave the space without an administrator', async () => {
    await expect(as('admin', () => setPermissionsUseCase(spaceKey, { email: emails.admin, permissions: ['VIEW'] }))).rejects.toBeInstanceOf(ConflictError);
    // Refused whole: the administrator still administers.
    expect(await effectivePermissions(ids.admin, spaceId)).toContain('ADMIN');
  });

  it('counts an administrator who holds ADMIN through a group', async () => {
    const group = await as('instanceAdmin', () => groups.createGroupUseCase(`pa-${tag}-admins`));
    await as('instanceAdmin', () => groups.addGroupMemberUseCase(group.id, emails.member));
    await as('admin', () => setPermissionsUseCase(spaceKey, { group: group.name, permissions: ['ADMIN'] }));
    // Now the direct administrator may step down: the group's member still administers.
    await as('admin', () => setPermissionsUseCase(spaceKey, { email: emails.admin, permissions: ['VIEW'] }));
    expect(await effectivePermissions(ids.member, spaceId)).toContain('ADMIN');
    // Restore, as the group member.
    await as('member', () => setPermissionsUseCase(spaceKey, { email: emails.admin, permissions: ['ADMIN'] }));
  });

  it('is ADMIN only', async () => {
    await expect(as('newcomer', () => listPermissionsUseCase(spaceKey))).rejects.toBeInstanceOf(NotFoundError);
    await as('admin', () => setPermissionsUseCase(spaceKey, { email: emails.newcomer, permissions: ['VIEW', 'EDIT'] }));
    await expect(as('newcomer', () => setPermissionsUseCase(spaceKey, { email: emails.newcomer, permissions: ['ADMIN'] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('audits each change with who, from and to (spec 07 §6)', async () => {
    const rows = await prisma.auditEvent.findMany({
      where: { spaceId, operation: 'permission-change', objectId: ids.newcomer },
      orderBy: { at: 'asc' },
    });
    expect(rows[0]?.actorId).toBe(ids.admin);
    expect(rows[0]?.parameters).toMatchObject({ from: [], to: ['VIEW', 'EDIT'] });
    expect(rows[1]?.parameters).toMatchObject({ from: ['VIEW', 'EDIT'], to: [] });
  });
});

describe('groups (instance-wide, RD-061)', () => {
  it('are managed by instance administrators only, and every change is audited', async () => {
    await expect(as('admin', () => groups.createGroupUseCase(`pa-${tag}-nope`))).rejects.toBeInstanceOf(ForbiddenError);
    const group = await as('instanceAdmin', () => groups.createGroupUseCase(`pa-${tag}-audit`));
    await as('instanceAdmin', () => groups.addGroupMemberUseCase(group.id, emails.newcomer));
    await as('instanceAdmin', () => groups.removeGroupMemberUseCase(group.id, ids.newcomer));
    await as('instanceAdmin', () => groups.deleteGroupUseCase(group.id));
    const operations = (
      await prisma.auditEvent.findMany({ where: { objectType: 'Group', objectId: group.id }, orderBy: { at: 'asc' } })
    ).map((row) => row.operation);
    expect(operations).toEqual(['create', 'member-add', 'member-remove', 'delete']);
  });

  it('take their permissions and restriction grants with them when deleted', async () => {
    const group = await as('instanceAdmin', () => groups.createGroupUseCase(`pa-${tag}-gone`));
    await as('admin', () => setPermissionsUseCase(spaceKey, { group: group.name, permissions: ['VIEW'] }));
    await as('instanceAdmin', () => groups.deleteGroupUseCase(group.id));
    expect(await prisma.membership.count({ where: { groupId: group.id } })).toBe(0);
  });
});
