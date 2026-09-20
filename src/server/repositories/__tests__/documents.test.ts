import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { prisma } from '../client';
import {
  createDocument,
  findDocument,
  listDocumentTree,
  listVersions,
  moveDocument,
  saveDocumentVersion,
  softDeleteDocument,
} from '../documents';
import { hashPassword } from '@/server/auth/password';

const richDocument: PMNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Interfaces' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Title' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Category' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Log access' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Security' }] }] },
          ],
        },
      ],
    },
  ],
};

describe('documents and versions', () => {
  let spaceId = '';
  let userId = '';

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `doc-${stamp}@test`, name: 'Doc', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    const space = await prisma.space.create({ data: { key: `TD${stamp % 100000}`, name: 'Docs' } });
    spaceId = space.id;
  });

  afterAll(async () => {
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates a document with version 1 and points at it', async () => {
    const document = await createDocument({ spaceId, title: 'Spec', parentId: null, authorId: userId });
    expect(document.currentVersion?.number).toBe(1);
    expect(document.currentVersionId).toBe(document.currentVersion?.id);
  });

  it('writes a new immutable version on every save and round-trips tables and lists', async () => {
    const document = await createDocument({ spaceId, title: 'Versioned', parentId: null, authorId: userId });

    const second = await saveDocumentVersion({
      documentId: document.id,
      content: richDocument,
      authorId: userId,
      message: 'Add interfaces',
    });
    const third = await saveDocumentVersion({
      documentId: document.id,
      content: { ...richDocument, content: [...(richDocument.content ?? [])] },
      authorId: userId,
    });

    expect(second.number).toBe(2);
    expect(third.number).toBe(3);

    const versions = await listVersions(document.id);
    expect(versions.map((v) => v.number)).toEqual([3, 2, 1]);

    const reloaded = await findDocument(spaceId, document.id);
    expect(reloaded?.currentVersion?.number).toBe(3);
    // Acceptance: "write a document with tables and lists, reload, see it unchanged".
    expect(reloaded?.currentVersion?.content).toEqual(richDocument);

    // Earlier versions are untouched by later saves.
    expect(versions.find((v) => v.number === 2)?.content).toEqual(richDocument);
  });

  it('builds the tree, refuses a cyclic move and soft-deletes a subtree', async () => {
    const parent = await createDocument({ spaceId, title: 'Parent', parentId: null, authorId: userId });
    const child = await createDocument({ spaceId, title: 'Child', parentId: parent.id, authorId: userId });
    const grandchild = await createDocument({ spaceId, title: 'Grandchild', parentId: child.id, authorId: userId });

    const tree = await listDocumentTree(spaceId);
    const parentNode = tree.find((node) => node.id === parent.id);
    expect(parentNode?.children.map((node) => node.id)).toEqual([child.id]);
    expect(parentNode?.children[0]?.children.map((node) => node.id)).toEqual([grandchild.id]);

    await expect(moveDocument(spaceId, parent.id, grandchild.id)).rejects.toThrow(/inside itself/);

    const removed = await softDeleteDocument(spaceId, parent.id);
    expect(new Set(removed)).toEqual(new Set([parent.id, child.id, grandchild.id]));

    // Soft delete: the versions survive, because a baseline may pin one (invariant D1).
    expect(await prisma.documentVersion.count({ where: { documentId: parent.id } })).toBe(1);
    expect(await findDocument(spaceId, parent.id)).toBeNull();
  });
});
