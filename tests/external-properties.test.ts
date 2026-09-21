import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion, softDeleteDocument } from '@/server/repositories/documents';
import {
  countValues,
  deleteDefinition,
  fetchValuesFor,
  listDefinitions,
  loadExternalTypes,
  setValueForRequirements,
  updateDefinition,
} from '@/server/repositories/external-properties';
import { applyIndexResult } from '@/server/repositories/requirements';

/**
 * Slice 11's acceptance, from PLAN.md: external values survive reindex, rename and
 * document deletion. Plus the invariants the schema now carries — E1, E2, E3 — asserted
 * through raw SQL, because a constraint that only the ORM honours is not a constraint.
 */

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;

let spaceId = '';
let spaceKey = '';
let userId = '';
let approvalId = '';
let riskId = '';

async function saveAndIndex(documentId: string, content: PMNode) {
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, {
        spaceId,
        spaceKey,
        documentId,
        versionId: version.id,
        actorId: userId,
        result,
      });
    },
  });
}

async function requirementByKey(key: string) {
  return prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: key } });
}

describe('external properties', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `ext-${tag}@test`, name: 'External', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `XP${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'External properties' } });
    spaceId = space.id;

    const approval = await prisma.externalPropertyDefinition.create({
      data: { name: `Approval ${tag}`, dataType: 'ENUM', enumValues: ['Pending', 'Signed off'] },
    });
    approvalId = approval.id;
    const risk = await prisma.externalPropertyDefinition.create({
      data: { name: `RiskScore${tag}`, dataType: 'NUMBER', enumValues: [] },
    });
    riskId = risk.id;
  });

  afterAll(async () => {
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.externalPropertyDefinition.deleteMany({ where: { id: { in: [approvalId, riskId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const definition = (id: string, name: string) => ({ id, name, searchName: name.toLowerCase() });

  it('sets a value, and setting it again replaces rather than appends (E2, RD-038)', async () => {
    const document = await createDocument({ spaceId, title: 'Values A', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('FN-001'), text(' First.'))));
    const requirement = await requirementByKey('FN-001');

    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(approvalId, 'Approval'),
      value: 'Pending',
    });
    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(approvalId, 'Approval'),
      value: 'Signed off',
    });

    const values = await fetchValuesFor([requirement.id], [approvalId]);
    expect(values).toHaveLength(1);
    expect(values[0]!.value).toBe('Signed off');
  });

  it('clears a value when it is set to null', async () => {
    const requirement = await requirementByKey('FN-001');
    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(approvalId, 'Approval'),
      value: null,
    });
    expect(await fetchValuesFor([requirement.id], [approvalId])).toEqual([]);

    // Put it back for the tests that follow.
    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(approvalId, 'Approval'),
      value: 'Signed off',
    });
  });

  it('writes a whole population in one statement, skipping baselined rows', async () => {
    const document = await createDocument({ spaceId, title: 'Values B', parentId: null, authorId: userId });
    await saveAndIndex(
      document.id,
      doc(
        para(marker('FN-010'), text(' Ten.')),
        para(marker('FN-011'), text(' Eleven.')),
        para(marker('FN-012'), text(' Twelve.')),
      ),
    );
    const ids = (
      await prisma.requirement.findMany({ where: { spaceId, upperKey: { startsWith: 'FN-01' } }, select: { id: true } })
    ).map((row) => row.id);
    expect(ids).toHaveLength(3);

    const written = await setValueForRequirements({
      requirementIds: ids,
      definition: definition(riskId, 'RiskScore'),
      value: '4',
    });
    expect(written).toBe(3);
    expect(await fetchValuesFor(ids, [riskId])).toHaveLength(3);
  });

  // --- the acceptance: reindex, rename, document deletion ------------------------------

  it('survives a reindex (contract I2)', async () => {
    const document = await createDocument({ spaceId, title: 'Survives A', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('FN-100'), text(' Before.'))));
    const requirement = await requirementByKey('FN-100');

    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(riskId, 'RiskScore'),
      value: '7',
    });

    await saveAndIndex(document.id, doc(para(marker('FN-100'), text(' After, quite different.'))));

    const after = await requirementByKey('FN-100');
    expect(after.title).toBe('After, quite different.');
    expect(await fetchValuesFor([after.id], [riskId])).toMatchObject([{ value: '7' }]);
  });

  it('survives a rename: the value hangs off the requirement, never off the key', async () => {
    const requirement = await requirementByKey('FN-100');
    await prisma.requirement.update({
      where: { id: requirement.id },
      data: { key: 'FN-100-RENAMED', upperKey: 'FN-100-RENAMED' },
    });

    const renamed = await requirementByKey('FN-100-RENAMED');
    expect(renamed.id).toBe(requirement.id);
    expect(await fetchValuesFor([renamed.id], [riskId])).toMatchObject([{ value: '7' }]);
  });

  it('survives document deletion, and the requirement is marked DELETED (contract I3)', async () => {
    const document = await createDocument({ spaceId, title: 'Survives B', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker('FN-200'), text(' Doomed document.'))));
    const requirement = await requirementByKey('FN-200');

    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(approvalId, 'Approval'),
      value: 'Signed off',
    });

    await softDeleteDocument(spaceId, document.id, userId);

    const after = await requirementByKey('FN-200');
    // The row survives — that is what makes broken links and key sequences work (I3).
    expect(after.status).toBe('DELETED');
    expect(await fetchValuesFor([after.id], [approvalId])).toMatchObject([{ value: 'Signed off' }]);
  });

  it('marks every requirement of a deleted subtree, not just the document named', async () => {
    const parent = await createDocument({ spaceId, title: 'Parent', parentId: null, authorId: userId });
    const child = await createDocument({ spaceId, title: 'Child', parentId: parent.id, authorId: userId });
    await saveAndIndex(parent.id, doc(para(marker('FN-300'), text(' In the parent.'))));
    await saveAndIndex(child.id, doc(para(marker('FN-301'), text(' In the child.'))));

    await softDeleteDocument(spaceId, parent.id, userId);

    expect((await requirementByKey('FN-300')).status).toBe('DELETED');
    expect((await requirementByKey('FN-301')).status).toBe('DELETED');
  });

  // --- the invariants the database carries ---------------------------------------------

  it('E1: an EXTERNAL value without a definition is rejected by the database', async () => {
    const requirement = await requirementByKey('FN-001');
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Property" ("id", "requirementId", "kind", "name", "searchName", "value")
        VALUES ('e1-probe', ${requirement.id}, 'EXTERNAL'::"PropertyKind", 'Loose', 'loose', 'x')
      `,
    ).rejects.toThrow();
  });

  it('E2: a second value for the same definition is rejected by the database', async () => {
    const requirement = await requirementByKey('FN-001');
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Property" ("id", "requirementId", "kind", "name", "searchName", "value", "definitionId")
        VALUES ('e2-probe', ${requirement.id}, 'EXTERNAL'::"PropertyKind", 'Approval', 'approval', 'Pending', ${approvalId})
      `,
    ).rejects.toThrow();
  });

  it('E2 does not constrain INLINE properties, which stay list-valued (RD-027)', async () => {
    const requirement = await requirementByKey('FN-001');
    await prisma.property.createMany({
      data: [
        { requirementId: requirement.id, kind: 'INLINE', name: 'Tag', searchName: 'tag', value: 'a', valueIndex: 0 },
        { requirementId: requirement.id, kind: 'INLINE', name: 'Tag', searchName: 'tag', value: 'b', valueIndex: 1 },
      ],
    });
    const tags = await prisma.property.findMany({ where: { requirementId: requirement.id, searchName: 'tag' } });
    expect(tags).toHaveLength(2);
  });

  it('E3: two definitions may not differ only in case', async () => {
    await expect(
      prisma.externalPropertyDefinition.create({
        data: { name: `approval ${tag}`, dataType: 'STRING', enumValues: [] },
      }),
    ).rejects.toThrow();
  });

  // --- definitions ----------------------------------------------------------------------

  it('refuses to delete a definition while values exist, and allows it once they are gone', async () => {
    const spare = await prisma.externalPropertyDefinition.create({
      data: { name: `Spare ${tag}`, dataType: 'STRING', enumValues: [] },
    });
    const requirement = await requirementByKey('FN-001');
    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(spare.id, 'Spare'),
      value: 'in use',
    });

    expect(await countValues(spare.id)).toBe(1);
    await expect(deleteDefinition(spare.id)).rejects.toThrow(/still holds 1 value/);

    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(spare.id, 'Spare'),
      value: null,
    });
    await expect(deleteDefinition(spare.id)).resolves.toBeUndefined();
  });

  it('carries a renamed definition across to the values already filed against it', async () => {
    const renamed = await prisma.externalPropertyDefinition.create({
      data: { name: `Owner ${tag}`, dataType: 'STRING', enumValues: [] },
    });
    const requirement = await requirementByKey('FN-001');
    await setValueForRequirements({
      requirementIds: [requirement.id],
      definition: definition(renamed.id, `Owner ${tag}`),
      value: 'Ada',
    });

    await updateDefinition(renamed.id, {
      name: `Accountable ${tag}`,
      dataType: 'STRING',
      enumValues: [],
      description: null,
    });

    const row = await prisma.property.findFirstOrThrow({ where: { definitionId: renamed.id } });
    expect(row.name).toBe(`Accountable ${tag}`);
    expect(row.searchName).toBe(`accountable ${tag}`);

    await prisma.property.deleteMany({ where: { definitionId: renamed.id } });
    await prisma.externalPropertyDefinition.delete({ where: { id: renamed.id } });
  });

  it('hands the query engine the declared types, keyed by lookup name (RD-037)', async () => {
    const types = await loadExternalTypes();
    expect(types[`approval ${tag}`.toLowerCase()]).toEqual({
      dataType: 'ENUM',
      enumValues: ['Pending', 'Signed off'],
    });
    expect(types[`riskscore${tag}`.toLowerCase()]?.dataType).toBe('NUMBER');

    const names = (await listDefinitions()).map((row) => row.searchName);
    expect(names).toContain(`riskscore${tag}`.toLowerCase());
  });
});
