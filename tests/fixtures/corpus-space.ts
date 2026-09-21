import { PrismaClient, type Prisma } from '@prisma/client';
import { emptyDocument } from '@/domain/doc';

/**
 * The fixture database for corpus item 6 (spec 02 §10): ~500 requirements with
 * properties, dependencies, labels, a baseline, deleted rows and a restricted document.
 * Deterministic — every value is a function of the requirement's index, so a corpus
 * expectation can be written as a rule rather than a list.
 */
export const CATEGORIES = ['Functional', 'Safety', 'Security', 'Performance'] as const;
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;

export const COUNTS = { functional: 300, business: 150, interface: 50 } as const;

export type FixtureHandles = {
  spaceId: string;
  spaceKey: string;
  otherSpaceId: string;
  otherSpaceKey: string;
  userId: string;
  strangerId: string;
  documentIds: string[];
  restrictedDocumentId: string;
  baselineId: string;
  baselineNumber: number;
};

export function keyOf(index: number): string {
  if (index < COUNTS.functional) return `FN-${String(index + 1).padStart(3, '0')}`;
  if (index < COUNTS.functional + COUNTS.business) {
    return `BR-${String(index - COUNTS.functional + 1).padStart(3, '0')}`;
  }
  return `IF-${String(index - COUNTS.functional - COUNTS.business + 1).padStart(3, '0')}`;
}

export const TOTAL = COUNTS.functional + COUNTS.business + COUNTS.interface;

export function categoryOf(index: number): string {
  return CATEGORIES[index % CATEGORIES.length]!;
}

export function priorityOf(index: number): string {
  return PRIORITIES[index % PRIORITIES.length]!;
}

/** Every tenth requirement has no Category at all — the absence-as-false cases. */
export function hasCategory(index: number): boolean {
  return index % 10 !== 7;
}

/** Every 25th requirement is DELETED; the rest are ACTIVE. */
export function isDeleted(index: number): boolean {
  return index % 25 === 24;
}

/** Requirements in the restricted document: indexes 400–419. */
export function isRestricted(index: number): boolean {
  return index >= 400 && index < 420;
}

export function documentOf(index: number): 0 | 1 | 2 {
  if (isRestricted(index)) return 2;
  return index < COUNTS.functional ? 0 : 1;
}

/**
 * A unique tag per fixture. Test files run in parallel against one database, so a
 * timestamp is not unique enough: two files starting in the same millisecond would
 * collide on the user's email and the space key.
 */
function uniqueTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

export async function createCorpusSpace(prisma: PrismaClient, tag = uniqueTag()): Promise<FixtureHandles> {
  const suffix = tag.replace(/[^A-Z0-9]/g, '').slice(-12);

  const user = await prisma.user.create({
    data: { email: `corpus-${suffix}@test`, name: 'Corpus', passwordHash: 'scrypt$x$y' },
  });
  const stranger = await prisma.user.create({
    data: { email: `stranger-${suffix}@test`, name: 'Stranger', passwordHash: 'scrypt$x$y' },
  });

  const space = await prisma.space.create({ data: { key: `CQ${suffix}`, name: 'Corpus' } });
  const other = await prisma.space.create({ data: { key: `CO${suffix}`, name: 'Other' } });

  await prisma.membership.create({
    data: { spaceId: space.id, userId: user.id, permissions: ['VIEW', 'EDIT', 'EXPORT'] },
  });
  await prisma.membership.create({ data: { spaceId: other.id, userId: user.id, permissions: ['VIEW'] } });
  // The stranger can run the same screens as the owner — what differs is which documents
  // they may read, which is what the visibility tests are about.
  await prisma.membership.create({
    data: { spaceId: space.id, userId: stranger.id, permissions: ['VIEW', 'EXPORT'] },
  });

  const documents: string[] = [];
  const versions: string[] = [];
  for (const title of ['Functional specification', 'Business rules', 'Restricted annex']) {
    const document = await prisma.document.create({ data: { spaceId: space.id, title } });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        number: 1,
        content: emptyDocument() as unknown as Prisma.InputJsonValue,
        authorId: user.id,
      },
    });
    await prisma.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
    documents.push(document.id);
    versions.push(version.id);
  }

  // The annex is restricted to `user`; `stranger` may not see its requirements (rule X1).
  await prisma.document.update({ where: { id: documents[2]! }, data: { restrictionMode: 'EXPLICIT' } });
  await prisma.documentRestriction.create({
    data: { documentId: documents[2]!, userId: user.id, canView: true, canEdit: true },
  });

  const baseline = await prisma.baseline.create({
    data: { spaceId: space.id, number: 1, name: 'Release 1', state: 'FROZEN', sourceQuery: "key ~ 'FN-%'", frozenAt: new Date() },
  });

  const rows: Prisma.RequirementCreateManyInput[] = [];
  for (let index = 0; index < TOTAL; index += 1) {
    const key = keyOf(index);
    rows.push({
      spaceId: space.id,
      key,
      upperKey: key,
      uid: `uid-${key}`,
      title: `Requirement ${key}`,
      bodyHtml: `<p>Requirement ${key}</p>`,
      bodySearch: `Requirement ${key} shall behave predictably`,
      anchorPath: `0.${index}`,
      status: isDeleted(index) ? 'DELETED' : 'ACTIVE',
      originVersionId: versions[documentOf(index)]!,
    });
  }
  await prisma.requirement.createMany({ data: rows });

  const created = await prisma.requirement.findMany({
    where: { spaceId: space.id, baselineId: null },
    select: { id: true, upperKey: true },
  });
  const idByKey = new Map(created.map((row) => [row.upperKey, row.id]));

  const properties: Prisma.PropertyCreateManyInput[] = [];
  const labels: Prisma.RequirementLabelCreateManyInput[] = [];
  for (let index = 0; index < TOTAL; index += 1) {
    const requirementId = idByKey.get(keyOf(index))!;
    if (hasCategory(index)) {
      properties.push({
        requirementId,
        kind: 'INLINE',
        name: 'Category',
        searchName: 'category',
        value: categoryOf(index),
        valueOrdinal: 0,
        valueIndex: 0,
      });
    }
    properties.push({
      requirementId,
      kind: 'INLINE',
      name: 'Priority',
      searchName: 'priority',
      value: priorityOf(index),
      valueOrdinal: 1,
      valueIndex: 0,
    });
    properties.push({
      requirementId,
      kind: 'INLINE',
      name: 'Release date',
      searchName: 'release date',
      value: `2026-0${(index % 9) + 1}-15`,
      valueOrdinal: 2,
      valueIndex: 0,
    });
    // A list-valued property: two members on every third requirement (RD-027).
    if (index % 3 === 0) {
      properties.push(
        { requirementId, kind: 'INLINE', name: 'Tags', searchName: 'tags', value: 'safety', valueOrdinal: 3, valueIndex: 0 },
        { requirementId, kind: 'INLINE', name: 'Tags', searchName: 'tags', value: 'audit', valueOrdinal: 3, valueIndex: 1 },
      );
    }
    if (index % 50 === 0) {
      properties.push({
        requirementId,
        kind: 'EXTERNAL',
        name: 'Approval',
        searchName: 'approval',
        value: 'Signed off',
        valueOrdinal: 4,
        valueIndex: 0,
      });
      labels.push({ requirementId, label: 'critical' });
    }
  }
  await prisma.property.createMany({ data: properties });
  await prisma.requirementLabel.createMany({ data: labels });

  // The defining occurrence of each requirement, which is what the `document` field reads.
  await prisma.documentLink.createMany({
    data: Array.from({ length: TOTAL }, (_, index) => ({
      requirementId: idByKey.get(keyOf(index))!,
      versionId: versions[documentOf(index)]!,
      origin: true,
      anchorPath: `0.${index}`,
    })),
  });

  // FN-n refines BR-((n-1) mod 150 + 1): the child is the requirement containing the link
  // (invariant P1), so FN is the child and BR the parent.
  const dependencies: Prisma.DependencyCreateManyInput[] = [];
  for (let index = 0; index < COUNTS.functional; index += 1) {
    const childId = idByKey.get(keyOf(index))!;
    const parentId = idByKey.get(keyOf(COUNTS.functional + (index % COUNTS.business)))!;
    dependencies.push({ relationship: 'refines', parentId, childId });
  }
  await prisma.dependency.createMany({ data: dependencies });

  // Twenty frozen rows, so baseline queries have something to match.
  const frozen: Prisma.RequirementCreateManyInput[] = [];
  for (let index = 0; index < 20; index += 1) {
    const key = keyOf(index);
    frozen.push({
      spaceId: space.id,
      key,
      upperKey: key,
      uid: `uid-${key}`,
      baselineId: baseline.id,
      title: `Requirement ${key} (frozen)`,
      bodyHtml: `<p>Requirement ${key}</p>`,
      bodySearch: `Requirement ${key} shall behave predictably`,
      anchorPath: `0.${index}`,
      status: 'ACTIVE',
      originVersionId: versions[documentOf(index)]!,
    });
  }
  await prisma.requirement.createMany({ data: frozen });

  return {
    spaceId: space.id,
    spaceKey: space.key,
    otherSpaceId: other.id,
    otherSpaceKey: other.key,
    userId: user.id,
    strangerId: stranger.id,
    documentIds: documents,
    restrictedDocumentId: documents[2]!,
    baselineId: baseline.id,
    baselineNumber: baseline.number,
  };
}

export async function dropCorpusSpace(prisma: PrismaClient, handles: FixtureHandles): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DELETE FROM "Dependency" WHERE "childId" IN (SELECT id FROM "Requirement" WHERE "spaceId" = $1)',
    handles.spaceId,
  );
  await prisma.documentLink.deleteMany({ where: { requirement: { spaceId: handles.spaceId } } });
  await prisma.property.deleteMany({ where: { requirement: { spaceId: handles.spaceId } } });
  await prisma.requirementLabel.deleteMany({ where: { requirement: { spaceId: handles.spaceId } } });
  await prisma.requirement.deleteMany({ where: { spaceId: handles.spaceId } });
  await prisma.baseline.deleteMany({ where: { spaceId: handles.spaceId } });
  await prisma.documentRestriction.deleteMany({ where: { documentId: { in: handles.documentIds } } });
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: handles.documentIds } } });
  await prisma.document.deleteMany({ where: { id: { in: handles.documentIds } } });
  await prisma.membership.deleteMany({ where: { spaceId: { in: [handles.spaceId, handles.otherSpaceId] } } });
  await prisma.space.deleteMany({ where: { id: { in: [handles.spaceId, handles.otherSpaceId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [handles.userId, handles.strangerId] } } });
}
