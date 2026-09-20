import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '../client';
import { createDocument, saveDocumentVersion } from '../documents';
import { applyIndexResult } from '../requirements';

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

let spaceId = '';
let spaceKey = '';
let userId = '';

/** Saves `content` as a new version of `documentId` and indexes it, as the app does. */
async function saveAndIndex(documentId: string, content: PMNode) {
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  let outcome: Awaited<ReturnType<typeof applyIndexResult>> | null = null;
  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      outcome = await applyIndexResult(tx, {
        spaceId,
        spaceKey,
        documentId,
        versionId: version.id,
        actorId: userId,
        result,
      });
    },
  });
  return outcome!;
}

describe('applyIndexResult — contracts I2 and I3, rule S3', () => {
  beforeAll(async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `idx-${stamp}@test`, name: 'Indexer', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `TI${stamp % 100000}`;
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Indexing' } });
    spaceId = space.id;
  });

  afterAll(async () => {
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates requirement rows with the origin link pointing at the saved version', async () => {
    const document = await createDocument({ spaceId, title: 'Spec A', parentId: null, authorId: userId });
    const outcome = await saveAndIndex(document.id, doc(para(marker('FN-001'), text(' Log every access.'))));

    expect(outcome.created).toHaveLength(1);
    const requirement = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-001' } });
    expect(requirement.title).toBe('Log every access.');
    expect(requirement.baselineId).toBeNull();
    expect(requirement.status).toBe('ACTIVE');

    const link = await prisma.documentLink.findFirstOrThrow({ where: { requirementId: requirement.id } });
    expect(link.origin).toBe(true);
    const version = await prisma.documentVersion.findUniqueOrThrow({ where: { id: requirement.originVersionId! } });
    expect(version.documentId).toBe(document.id);
    expect(version.id).toBe(link.versionId);
  });

  it('I3: a marker removed from the document marks the row DELETED and keeps it', async () => {
    const document = await createDocument({ spaceId, title: 'Spec B', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('FN-100'), text(' First.'))));

    const outcome = await saveAndIndex(document.id, doc(para(text('The marker is gone.'))));
    expect(outcome.deleted).toHaveLength(1);

    const requirement = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-100' } });
    expect(requirement.status).toBe('DELETED');
    expect(requirement.title).toBe('First.');

    // And it comes back to life when the marker returns.
    await saveAndIndex(document.id, doc(para(marker('FN-100'), text(' Back.'))));
    const revived = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-100' } });
    expect(revived.status).toBe('ACTIVE');
    expect(revived.id).toBe(requirement.id);
    expect(revived.title).toBe('Back.');
  });

  it('I2: reindexing rewrites inline properties but never touches external ones', async () => {
    const document = await createDocument({ spaceId, title: 'Spec C', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('FN-200'), text(' With properties.'))));
    const requirement = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-200' } });

    await prisma.property.createMany({
      data: [
        { requirementId: requirement.id, kind: 'INLINE', name: 'Category', searchName: 'category', value: 'Security' },
        { requirementId: requirement.id, kind: 'EXTERNAL', name: 'Approval', searchName: 'approval', value: 'Signed off' },
      ],
    });

    await saveAndIndex(document.id, doc(para(marker('FN-200'), text(' Changed.'))));

    const properties = await prisma.property.findMany({ where: { requirementId: requirement.id } });
    expect(properties.map((property) => property.kind)).toEqual(['EXTERNAL']);
    expect(properties[0]!.value).toBe('Signed off');
  });

  it('I2: a reindex never touches requirements defined in another document', async () => {
    const a = await createDocument({ spaceId, title: 'Spec D1', parentId: null, authorId: userId });
    const b = await createDocument({ spaceId, title: 'Spec D2', parentId: null, authorId: userId });
    await saveAndIndex(a.id, doc(para(marker('FN-300'), text(' Owned by A.'))));
    await saveAndIndex(b.id, doc(para(marker('FN-301'), text(' Owned by B.'))));

    await saveAndIndex(b.id, doc(para(text('B is now empty.'))));

    const fromA = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-300' } });
    expect(fromA.status).toBe('ACTIVE');
    const fromB = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-301' } });
    expect(fromB.status).toBe('DELETED');
  });

  it('S3 / RD-025: a key claimed by a second document keeps one row and flags both documents', async () => {
    const a = await createDocument({ spaceId, title: 'Spec E1', parentId: null, authorId: userId });
    const b = await createDocument({ spaceId, title: 'Spec E2', parentId: null, authorId: userId });
    await saveAndIndex(a.id, doc(para(marker('FN-400'), text(' The original.'))));
    const outcome = await saveAndIndex(b.id, doc(para(marker('FN-400'), text(' The impostor.'))));

    expect(outcome.created).toHaveLength(0);
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KEY_CONFLICT');

    const rows = await prisma.requirement.findMany({ where: { spaceId, upperKey: 'FN-400' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('The original.');

    // Invariant R1 holds, and both documents show the conflict (rule S3).
    const onA = await prisma.indexDiagnostic.findMany({ where: { documentId: a.id, code: 'KEY_CONFLICT' } });
    const onB = await prisma.indexDiagnostic.findMany({ where: { documentId: b.id, code: 'KEY_CONFLICT' } });
    expect(onA).toHaveLength(1);
    expect(onB).toHaveLength(1);
    expect(onA[0]!.relatedDocumentId).toBe(b.id);
    expect(onB[0]!.relatedDocumentId).toBe(a.id);
  });

  it('records a citation as a non-origin link, and warns when it does not resolve', async () => {
    const document = await createDocument({ spaceId, title: 'Spec F', parentId: null, authorId: userId });
    await saveAndIndex(
      document.id,
      doc(para(marker('FN-500'), text(' Defined here.')), para(text('See '), { type: 'requirementLink', attrs: { key: 'FN-500' } })),
    );

    const requirement = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: 'FN-500' } });
    const links = await prisma.documentLink.findMany({ where: { requirementId: requirement.id } });
    expect(links.map((link) => link.origin).sort()).toEqual([false, true]);

    const outcome = await saveAndIndex(
      document.id,
      doc(para(marker('FN-500'), text(' Defined here.')), para({ type: 'requirementLink', attrs: { key: 'FN-999' } })),
    );
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain('UNRESOLVED_LINK');
  });
});
