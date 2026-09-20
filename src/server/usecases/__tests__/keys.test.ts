import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';

let spaceId = '';
let spaceKey = '';
let userId = '';

// The permission gate itself is covered by the authz tests; here we exercise the rules
// the use case adds on top of it (spec 03 §4.2 step 4).
vi.mock('@/server/authz', () => ({
  requireSpace: async () => ({
    user: { id: userId },
    space: { id: spaceId, key: spaceKey },
    permissions: ['VIEW', 'EDIT'],
    can: () => true,
  }),
}));

const { resetKeySequenceUseCase, suggestNextKeyUseCase } = await import('../keys');

const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const text = (value: string): PMNode => ({ type: 'text', text: value });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

async function saveAndIndex(documentId: string, content: PMNode) {
  const types = await prisma.requirementType.findMany({ where: { spaceId } });
  const result = indexDocumentVersion({
    content,
    space: {
      key: spaceKey,
      types: types.map((type) => ({ id: type.id, name: type.name, keyPattern: type.keyPattern, locked: type.locked })),
    },
  });
  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, { spaceId, spaceKey, documentId, versionId: version.id, actorId: userId, result });
    },
  });
}

describe('key suggestion and sequences (spec 03 §4.2)', () => {
  let typeId = '';

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `keys-${stamp}@test`, name: 'Keys', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `TK${stamp % 100000}`;
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Keys' } });
    spaceId = space.id;
    const type = await prisma.requirementType.create({
      data: { spaceId, name: 'Functional', keyPattern: 'FN-###', preventReusingDeletedKeys: true },
    });
    typeId = type.id;
  });

  afterAll(async () => {
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.requirementType.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('suggests the first key, then advances as keys are used', async () => {
    expect((await suggestNextKeyUseCase({ spaceKey })).key).toBe('FN-001');

    const document = await createDocument({ spaceId, title: 'Keys A', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('FN-001'), text(' One.')), para(marker('FN-002'), text(' Two.'))));

    expect((await suggestNextKeyUseCase({ spaceKey })).key).toBe('FN-003');
    const type = await prisma.requirementType.findUniqueOrThrow({ where: { id: typeId } });
    expect(type.nextSequence).toBe(3);
  });

  it('the sequence survives deletion: removing FN-002 does not hand the key back', async () => {
    const document = await prisma.document.findFirstOrThrow({ where: { spaceId } });
    await saveAndIndex(document.id, doc(para(marker('FN-001'), text(' One.'))));

    const removed = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-002' } });
    expect(removed.status).toBe('DELETED');
    expect((await suggestNextKeyUseCase({ spaceKey })).key).toBe('FN-003');
  });

  it('reset is refused while the pattern prevents reusing deleted keys', async () => {
    await expect(resetKeySequenceUseCase(spaceKey, typeId)).rejects.toThrow(/prevents reusing deleted keys/);
    expect((await prisma.requirementType.findUniqueOrThrow({ where: { id: typeId } })).nextSequence).toBe(3);
  });

  it('reset rewinds to the highest live key plus one once that is turned off', async () => {
    await prisma.requirementType.update({ where: { id: typeId }, data: { preventReusingDeletedKeys: false } });

    // FN-001 is the only live key; FN-002 is DELETED.
    expect(await resetKeySequenceUseCase(spaceKey, typeId)).toBe(2);
    expect((await suggestNextKeyUseCase({ spaceKey })).key).toBe('FN-002');
  });

  it('picks the type matching the keys already used in the document', async () => {
    await prisma.requirementType.create({ data: { spaceId, name: 'Business', keyPattern: 'BR-###' } });
    const document = await createDocument({ spaceId, title: 'Keys B', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('BR-001'), text(' Business rule.'))));

    const suggestion = await suggestNextKeyUseCase({ spaceKey, documentId: document.id });
    expect(suggestion.key).toBe('BR-002');
    expect(suggestion.keyPattern).toBe('BR-###');
  });
});
