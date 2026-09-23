import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import type { PMNode } from '@/domain/doc';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { effectivePermissions } from '@/server/repositories/spaces';
import { isDocumentVisible, viewerFor } from '@/server/repositories/visibility';

/**
 * Document restrictions. spec: 07-permissions-and-limits.md §2.2.
 * RD-056 (view inherits down the tree, edit does not), RD-057 (editors restrict, but not
 * themselves out), RD-058 (ADMIN unlocks without reading), RD-062 (audited).
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
type Who = 'author' | 'colleague' | 'admin' | 'reader';
const ids: Record<Who, string> = { author: '', colleague: '', admin: '', reader: '' };
let actor: Who = 'author';
let spaceId = '';
let spaceKey = '';
let groupId = '';

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
}));

const documents = await import('@/server/usecases/documents');
const restrictions = await import('@/server/usecases/restrictions');

const as = <T>(who: Who, work: () => Promise<T>): Promise<T> => {
  actor = who;
  return work();
};
const visibleTo = async (who: Who, documentId: string) => isDocumentVisible(await viewerFor(ids[who]), documentId);
const doc: PMNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }] };

beforeAll(async () => {
  for (const who of Object.keys(ids) as Who[]) {
    ids[who] = (
      await prisma.user.create({ data: { email: `rs-${who}-${tag}@test`, name: who, passwordHash: await hashPassword('x') } })
    ).id;
  }
  spaceKey = `RS${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Restrictions' } })).id;
  await prisma.membership.createMany({
    data: [
      { spaceId, userId: ids.author, permissions: ['VIEW', 'EDIT'] },
      { spaceId, userId: ids.colleague, permissions: ['VIEW', 'EDIT'] },
      { spaceId, userId: ids.admin, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
      { spaceId, userId: ids.reader, permissions: ['VIEW'] },
    ],
  });
  groupId = (await prisma.group.create({ data: { name: `rs-group-${tag}` } })).id;
}, 120_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { spaceId } });
  await prisma.documentViewGate.deleteMany({ where: { document: { spaceId } } });
  await prisma.documentRestriction.deleteMany({ where: { document: { spaceId } } });
  await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
  await prisma.documentLink.deleteMany({ where: { version: { document: { spaceId } } } });
  await prisma.requirement.deleteMany({ where: { spaceId } });
  await prisma.document.updateMany({ where: { spaceId }, data: { currentVersionId: null, parentId: null } });
  await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
  await prisma.document.deleteMany({ where: { spaceId } });
  await prisma.membership.deleteMany({ where: { spaceId } });
  await prisma.groupMember.deleteMany({ where: { groupId } });
  await prisma.group.deleteMany({ where: { id: groupId } });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

const restrictTo = (who: Who, documentId: string, grants: Array<{ userId?: string; groupId?: string; canView: boolean; canEdit: boolean }>) =>
  as(who, () => restrictions.setDocumentRestrictionUseCase({ spaceKey, documentId, mode: 'EXPLICIT', grants }));

describe('view restrictions inherit down the tree (RD-056)', () => {
  it('hides a child of a restricted parent, including a child created afterwards', async () => {
    const parent = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Parent' }));
    const before = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Child before', parentId: parent.id }));

    await restrictTo('author', parent.id, [{ userId: ids.author, canView: true, canEdit: true }]);
    const after = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Child after', parentId: parent.id }));

    for (const id of [parent.id, before.id, after.id]) {
      expect(await visibleTo('author', id)).toBe(true);
      expect(await visibleTo('reader', id)).toBe(false);
    }
    // The tree omits the whole subtree for the reader, not just the parent.
    const titles = JSON.stringify(await as('reader', () => documents.getDocumentTree(spaceKey)));
    expect(titles).not.toContain('Child before');
    expect(titles).not.toContain('Child after');
  });

  it('rebuilds the gates when a document moves in or out of a restricted subtree', async () => {
    const vault = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Vault' }));
    await restrictTo('author', vault.id, [{ userId: ids.author, canView: true, canEdit: true }]);
    const page = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Movable' }));
    expect(await visibleTo('reader', page.id)).toBe(true);

    await as('author', () => documents.moveDocumentUseCase(spaceKey, page.id, vault.id));
    expect(await visibleTo('reader', page.id)).toBe(false);

    await as('author', () => documents.moveDocumentUseCase(spaceKey, page.id, null));
    expect(await visibleTo('reader', page.id)).toBe(true);
  });

  it('admits a reader through a group grant, and stops when they leave the group', async () => {
    const shared = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Group only' }));
    await restrictTo('author', shared.id, [
      { userId: ids.author, canView: true, canEdit: true },
      { groupId, canView: true, canEdit: false },
    ]);
    expect(await visibleTo('reader', shared.id)).toBe(false);
    await prisma.groupMember.create({ data: { groupId, userId: ids.reader } });
    expect(await visibleTo('reader', shared.id)).toBe(true);
    await prisma.groupMember.deleteMany({ where: { groupId, userId: ids.reader } });
    expect(await visibleTo('reader', shared.id)).toBe(false);
  });
});

describe('the edit list (spec 07 §2.2; RD-056: it does not inherit)', () => {
  it('lets a viewer read but not save, rename, move or delete', async () => {
    const guarded = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Read only for colleague' }));
    await restrictTo('author', guarded.id, [
      { userId: ids.author, canView: true, canEdit: true },
      { userId: ids.colleague, canView: true, canEdit: false },
    ]);

    expect((await as('colleague', () => documents.openDocument(spaceKey, guarded.id))).title).toBe('Read only for colleague');
    expect(await as('colleague', () => documents.canEditDocument(spaceKey, guarded.id))).toBe(false);
    await expect(as('colleague', () => documents.saveDocumentUseCase({ spaceKey, documentId: guarded.id, content: doc }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('colleague', () => documents.renameDocumentUseCase(spaceKey, guarded.id, 'Hijacked'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('colleague', () => documents.moveDocumentUseCase(spaceKey, guarded.id, null))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('colleague', () => documents.deleteDocumentUseCase(spaceKey, guarded.id))).rejects.toBeInstanceOf(ForbiddenError);

    // The author, on the edit list, still can.
    await as('author', () => documents.saveDocumentUseCase({ spaceKey, documentId: guarded.id, content: doc }));
  });

  it('treats a hidden document as missing for every change (RD-064)', async () => {
    const secret = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Secret' }));
    await restrictTo('author', secret.id, [{ userId: ids.author, canView: true, canEdit: true }]);
    await expect(as('colleague', () => documents.saveDocumentUseCase({ spaceKey, documentId: secret.id, content: doc }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as('colleague', () => documents.createDocumentUseCase({ spaceKey, title: 'Under it', parentId: secret.id }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('who may restrict (RD-057)', () => {
  it('refuses a change that would lock its author out', async () => {
    const mine = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Lockout' }));
    await expect(restrictTo('author', mine.id, [{ userId: ids.colleague, canView: true, canEdit: true }])).rejects.toBeInstanceOf(ValidationError);
    // View without edit, while someone else holds edit, is a lockout from editing too.
    await expect(
      restrictTo('author', mine.id, [
        { userId: ids.author, canView: true, canEdit: false },
        { userId: ids.colleague, canView: true, canEdit: true },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
    // Nothing was written by the refused attempts.
    expect(await visibleTo('reader', mine.id)).toBe(true);
  });

  it('refuses a restriction with nobody on the view list', async () => {
    const empty = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Empty list' }));
    await expect(restrictTo('author', empty.id, [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses someone who may not edit the document, even with space EDIT', async () => {
    const theirs = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Not yours' }));
    await restrictTo('author', theirs.id, [
      { userId: ids.author, canView: true, canEdit: true },
      { userId: ids.colleague, canView: true, canEdit: false },
    ]);
    await expect(restrictTo('colleague', theirs.id, [{ userId: ids.colleague, canView: true, canEdit: true }])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a reader with VIEW only', async () => {
    const any = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Reader cannot' }));
    await expect(restrictTo('reader', any.id, [{ userId: ids.reader, canView: true, canEdit: true }])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('the ADMIN unlock (RD-058)', () => {
  it('lists restricted documents by title to an administrator who cannot open them, and unlocks one', async () => {
    const orphan = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Orphaned by a leaver' }));
    await restrictTo('author', orphan.id, [{ userId: ids.author, canView: true, canEdit: true }]);

    // No read bypass: the administrator gets "not found" like anyone else.
    await expect(as('admin', () => documents.openDocument(spaceKey, orphan.id))).rejects.toBeInstanceOf(NotFoundError);
    const listed = await as('admin', () => restrictions.listRestrictedDocumentsUseCase(spaceKey));
    expect(listed.map((row) => row.title)).toContain('Orphaned by a leaver');
    // Titles only: nothing else of the document is in the listing.
    expect(Object.keys(listed[0]!).sort()).toEqual(['editors', 'id', 'title', 'viewers']);

    await as('admin', () => restrictions.unlockDocumentUseCase(spaceKey, orphan.id));
    expect(await visibleTo('reader', orphan.id)).toBe(true);

    const audit = await prisma.auditEvent.findFirst({ where: { spaceId, objectId: orphan.id, operation: 'unlock' } });
    expect(audit?.actorId).toBe(ids.admin);
  });

  it('is ADMIN only, and cannot probe an unrestricted document', async () => {
    const open = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Already open' }));
    await expect(as('author', () => restrictions.listRestrictedDocumentsUseCase(spaceKey))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('admin', () => restrictions.unlockDocumentUseCase(spaceKey, open.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('audits every restriction change with its before and after (spec 07 §6)', async () => {
    const audited = await as('author', () => documents.createDocumentUseCase({ spaceKey, title: 'Audited' }));
    await restrictTo('author', audited.id, [{ userId: ids.author, canView: true, canEdit: true }]);
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { spaceId, objectId: audited.id, operation: 'restrict' } });
    expect(row.actorId).toBe(ids.author);
    expect(row.parameters).toMatchObject({ from: { mode: 'INHERIT' }, to: { mode: 'EXPLICIT' } });
  });
});
