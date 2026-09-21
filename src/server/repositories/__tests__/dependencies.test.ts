import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { parseAndAnalyse } from '@/domain/ryql';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '../client';
import { createDocument, saveDocumentVersion } from '../documents';
import { applyIndexResult } from '../requirements';
import { runSearch, visibilityPredicate } from '../search';

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string, attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'requirementLink',
  attrs: { key, ...attrs },
});
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

let spaceId = '';
let spaceKey = '';
let isolatedId = '';
let isolatedKey = '';
let userId = '';

async function saveAndIndex(documentId: string, content: PMNode, options: { isolated?: boolean } = {}) {
  const space = options.isolated
    ? { id: isolatedId, key: isolatedKey, isolated: true }
    : { id: spaceId, key: spaceKey, isolated: false };

  const result = indexDocumentVersion({ content, space: { key: space.key } });
  let outcome: Awaited<ReturnType<typeof applyIndexResult>> | null = null;

  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      outcome = await applyIndexResult(tx, {
        spaceId: space.id,
        spaceKey: space.key,
        isolated: space.isolated,
        documentId,
        versionId: version.id,
        actorId: userId,
        result,
      });
    },
  });

  return outcome!;
}

const edgesOf = async (childKey: string) =>
  prisma.dependency.findMany({
    where: { child: { upperKey: childKey } },
    include: { parent: { select: { upperKey: true, status: true } } },
  });

describe('dependencies in the database (invariants P1 and P2)', () => {
  beforeAll(async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `dep-${stamp}@test`, name: 'Dep', passwordHash: await hashPassword('x') },
    });
    userId = user.id;

    spaceKey = `TP${stamp % 100000}`;
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Dependencies' } });
    spaceId = space.id;
    await prisma.membership.create({ data: { spaceId, userId, permissions: ['VIEW', 'EDIT'] } });

    isolatedKey = `TQ${stamp % 100000}`;
    const isolated = await prisma.space.create({
      data: { key: isolatedKey, name: 'Isolated', isolated: true },
    });
    isolatedId = isolated.id;
  });

  afterAll(async () => {
    const spaces = [spaceId, isolatedId];
    await prisma.membership.deleteMany({ where: { spaceId: { in: spaces } } });
    await prisma.dependency.deleteMany({ where: { child: { spaceId: { in: spaces } } } });
    await prisma.unresolvedDependency.deleteMany({ where: { child: { spaceId: { in: spaces } } } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId: { in: spaces } } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId: { in: spaces } } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId: { in: spaces } } } });
    await prisma.requirement.deleteMany({ where: { spaceId: { in: spaces } } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId: { in: spaces } } } });
    await prisma.document.deleteMany({ where: { spaceId: { in: spaces } } });
    await prisma.space.deleteMany({ where: { id: { in: spaces } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('P1: the requirement containing the link becomes the child', async () => {
    const document = await createDocument({ spaceId, title: 'P1', parentId: null, authorId: userId });
    await saveAndIndex(
      document.id,
      doc(
        para(marker('BR-01'), text(' The business shall record every access.')),
        para(marker('FN-01'), text(' The system shall log every access, refining '), link('BR-01')),
      ),
    );

    const edges = await edgesOf('FN-01');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.parent.upperKey).toBe('BR-01');
    expect(edges[0]!.relationship).toBe('Dependency');

    // And nothing points the other way.
    expect(await edgesOf('BR-01')).toEqual([]);
  });

  it('P2: a link to a key that does not exist is retained as an UnresolvedDependency', async () => {
    const document = await createDocument({ spaceId, title: 'P2 missing', parentId: null, authorId: userId });
    const outcome = await saveAndIndex(
      document.id,
      doc(para(marker('FN-10'), text(' refines '), link('BR-999'))),
    );

    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain('UNRESOLVED_LINK');
    const rows = await prisma.unresolvedDependency.findMany({ where: { child: { upperKey: 'FN-10' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetKey: 'BR-999', targetSpaceKey: spaceKey, relationship: 'Dependency' });
  });

  it('RD-029: an unresolved link is promoted when the missing key appears', async () => {
    const later = await createDocument({ spaceId, title: 'P2 later', parentId: null, authorId: userId });
    await saveAndIndex(later.id, doc(para(marker('BR-999'), text(' Defined at last.'))));

    expect(await prisma.unresolvedDependency.count({ where: { child: { upperKey: 'FN-10' } } })).toBe(0);
    const edges = await edgesOf('FN-10');
    expect(edges.map((edge) => edge.parent.upperKey)).toEqual(['BR-999']);
  });

  it('acceptance: deleting the target leaves the dependency, it is never cascade-deleted', async () => {
    const target = await createDocument({ spaceId, title: 'Target', parentId: null, authorId: userId });
    const source = await createDocument({ spaceId, title: 'Source', parentId: null, authorId: userId });

    await saveAndIndex(target.id, doc(para(marker('BR-20'), text(' A business rule.'))));
    await saveAndIndex(source.id, doc(para(marker('FN-20'), text(' refines '), link('BR-20'))));
    expect((await edgesOf('FN-20')).map((edge) => edge.parent.upperKey)).toEqual(['BR-20']);

    // Remove the target's marker: contract I3 marks it DELETED and keeps the row…
    await saveAndIndex(target.id, doc(para(text('The marker is gone.'))));

    const edges = await edgesOf('FN-20');
    // …and the dependency survives, pointing at the deleted requirement (invariant P2).
    expect(edges).toHaveLength(1);
    expect(edges[0]!.parent).toMatchObject({ upperKey: 'BR-20', status: 'DELETED' });
  });

  it('contract I2: reindexing rewrites this document edges and leaves other documents alone', async () => {
    const other = await createDocument({ spaceId, title: 'Other edges', parentId: null, authorId: userId });
    await saveAndIndex(other.id, doc(para(marker('FN-30'), text(' refines '), link('BR-20'))));
    expect(await edgesOf('FN-30')).toHaveLength(1);

    // FN-20 is defined elsewhere and keeps its edge; FN-30 loses the one it declared.
    await saveAndIndex(other.id, doc(para(marker('FN-30'), text(' No longer refines anything.'))));
    expect(await edgesOf('FN-30')).toEqual([]);
    expect(await edgesOf('FN-20')).toHaveLength(1);
  });

  it('pins a link to a baseline of the target when one is named (research §4.1)', async () => {
    const baseline = await prisma.baseline.create({
      data: { spaceId, number: 7, name: 'Pinned', state: 'FROZEN', sourceQuery: "key ~ '%'" },
    });
    const document = await createDocument({ spaceId, title: 'Pinned link', parentId: null, authorId: userId });
    await saveAndIndex(
      document.id,
      doc(para(marker('FN-40'), text(' refines '), link('BR-20', { baselineNumber: 7 }))),
    );

    const edges = await edgesOf('FN-40');
    expect(edges[0]!.targetBaselineId).toBe(baseline.id);
  });

  it('spec 07 §3: an isolated space refuses a cross-space link and keeps it unresolved', async () => {
    const document = await createDocument({
      spaceId: isolatedId,
      title: 'Isolated source',
      parentId: null,
      authorId: userId,
    });
    const outcome = await saveAndIndex(
      document.id,
      doc(para(marker('IS-01'), text(' refines '), link('BR-20', { spaceKey }))),
      { isolated: true },
    );

    const refusal = outcome.diagnostics.find((diagnostic) => diagnostic.code === 'UNRESOLVED_LINK');
    expect(refusal?.severity).toBe('error');
    expect(refusal?.message).toContain('isolated');
    expect(await edgesOf('IS-01')).toEqual([]);
    expect(await prisma.unresolvedDependency.count({ where: { child: { upperKey: 'IS-01' } } })).toBe(1);
  });

  it('RQL to/from return the right rows over indexer-written edges (P1)', async () => {
    const keysFor = async (query: string) => {
      const analysed = parseAndAnalyse(query, { spaceKey, isolated: false });
      if (!analysed.ok) throw new Error(analysed.errors.map((error) => error.message).join('; '));
      const { rows } = await runSearch(analysed.query.expr, {
        visibility: visibilityPredicate(userId, []),
        limit: 100,
      });
      return rows.map((row) => row.key).sort();
    };

    // The 01 P1 example, end to end: FN-01 references BR-01, so BR-01 is its parent.
    expect(await keysFor("to = 'BR-01'")).toEqual(['FN-01']);
    expect(await keysFor("from = 'FN-01'")).toEqual(['BR-01']);
    expect(await keysFor("to -> key = 'BR-01'")).toEqual(['FN-01']);
    expect(await keysFor("to@Dependency = 'BR-01'")).toEqual(['FN-01']);
    expect(await keysFor("to@Refines = 'BR-01'")).toEqual([]);
  });

  it('names the relationship from the column header, and both directions are queryable', async () => {
    const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
    const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
    const row = (...content: PMNode[]): PMNode => ({ type: 'tableRow', content });

    const document = await createDocument({ spaceId, title: 'Table edges', parentId: null, authorId: userId });
    await saveAndIndex(
      document.id,
      doc({
        type: 'table',
        content: [
          row(th(para(text('Title'))), th(para(text('Refines'))), th(para(text('Key')))),
          row(td(para(text('Log access'))), td(para(link('BR-20'))), td(para(marker('FN-50')))),
        ],
      }),
    );

    const edges = await edgesOf('FN-50');
    expect(edges[0]!.relationship).toBe('Refines');

    const inbound = await prisma.dependency.findMany({
      where: { parent: { upperKey: 'BR-20' }, relationship: 'Refines' },
      include: { child: { select: { upperKey: true } } },
    });
    expect(inbound.map((edge) => edge.child.upperKey)).toContain('FN-50');
  });
});
