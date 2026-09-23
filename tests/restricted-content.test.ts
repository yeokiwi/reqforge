import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '@/domain/errors';
import { prisma } from '@/server/repositories/client';
import { baselinesContaining, listBaselines, countMembers, listDangling, listMembers } from '@/server/repositories/baselines';
import { listHistory } from '@/server/repositories/history';
import { resolveKeyAlias } from '@/server/repositories/rename';
import { findRequirementDetail, listBrokenLinks, listDocumentDiagnostics } from '@/server/repositories/requirements';
import { countDocuments, countRequirements, effectivePermissions } from '@/server/repositories/spaces';
import { countRequirementsOfType } from '@/server/repositories/requirement-types';
import { countByStatusForSpace } from '@/server/repositories/validations';
import { fetchReportData } from '@/server/repositories/traceability';
import { snapshotGatesForBaseline } from '@/server/repositories/restrictions';
import { visibilityPredicate } from '@/server/repositories/search';
import { viewerFor, type Viewer } from '@/server/repositories/visibility';
import { createCorpusSpace, dropCorpusSpace, keyOf, type FixtureHandles } from './fixtures/corpus-space';

/**
 * **Slice 16's acceptance: every list surface has a restricted-content test.**
 * spec: 07-permissions-and-limits.md §2.2 — rule X1 (a restriction reaches everywhere the
 * requirement would appear), X2 (hidden is omitted, not redacted, not counted; a link to
 * it shows as `restricted`), X3 (enforced in the repository layer).
 *
 * The fixture's "Restricted annex" holds BR-101…BR-120 and admits `user` only; `stranger`
 * has VIEW and EXPORT but is not on the list. FN-101 refines BR-101.
 *
 * Surfaces that go through the RQL compiler are covered where they were built, and are
 * listed here so the table is complete:
 *   search, select-all ........... tests/corpus-results.test.ts ("visibility is not optional")
 *   traceability matrix + columns  tests/matrix.test.ts ("visibility inside the matrix")
 *   report rows + edges .......... tests/report.test.ts ("a report never shows …")
 *   coverage + dependency matrix . tests/coverage.test.ts
 *   diff ......................... tests/diff.test.ts ("appears on neither side")
 *   bulk external value set ...... tests/external-matrix.test.ts
 * Everything else is below.
 */

let fixture: FixtureHandles;
let actor: 'user' | 'stranger' = 'user';
let user: Viewer;
let stranger: Viewer;
let baselineId = '';
let typeId = '';

// The gate is real: permissions come from the same lookup the app uses.
vi.mock('@/server/authz', () => ({
  requireSpace: async (_spaceKey: string, permission = 'VIEW') => {
    const userId = actor === 'stranger' ? fixture.strangerId : fixture.userId;
    const permissions = await effectivePermissions(userId, fixture.spaceId);
    if (!permissions.includes(permission as 'VIEW')) throw new ForbiddenError(`You need the ${permission} permission.`);
    const space = await prisma.space.findUniqueOrThrow({ where: { id: fixture.spaceId } });
    return {
      user: { id: userId },
      space,
      permissions,
      can: (candidate: string) => permissions.includes(candidate as 'VIEW'),
      viewer: await viewerFor(userId),
    };
  },
}));

const documents = await import('@/server/usecases/documents');
const { findRequirementsUseCase } = await import('@/server/usecases/requirement-picker');
const { runDependencyMatrixUseCase } = await import('@/server/usecases/dependency-matrix');
const { downloadExportUseCase } = await import('@/server/usecases/jobs');
const { edgesOf } = await import('@/app/s/[spaceKey]/r/edges');

const RESTRICTED = new Set(Array.from({ length: 20 }, (_, n) => keyOf(400 + n)));
const hidden = (keys: Iterable<string>) => [...keys].filter((key) => RESTRICTED.has(key.toUpperCase()));
const BR101 = keyOf(400);
const FN101 = keyOf(100);

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
  [user, stranger] = await Promise.all([viewerFor(fixture.userId), viewerFor(fixture.strangerId)]);

  const ids = new Map(
    (
      await prisma.requirement.findMany({
        where: { spaceId: fixture.spaceId, baselineId: null },
        select: { id: true, upperKey: true },
      })
    ).map((row) => [row.upperKey, row.id]),
  );
  const restrictedVersion = (await prisma.document.findUniqueOrThrow({
    where: { id: fixture.restrictedDocumentId },
    select: { currentVersionId: true },
  })).currentVersionId!;

  // A baseline with five restricted members, a dangling edge declared by one of them, and
  // the restriction captured as a freeze would capture it (rule X4, RD-059).
  const baseline = await prisma.baseline.create({
    data: { spaceId: fixture.spaceId, number: 2, name: 'Annex snapshot', state: 'FROZEN', sourceQuery: "key ~ 'BR-1%'", frozenAt: new Date() },
  });
  baselineId = baseline.id;
  await prisma.requirement.createMany({
    data: [...Array.from({ length: 5 }, (_, n) => keyOf(400 + n)), keyOf(0)].map((key) => ({
      spaceId: fixture.spaceId,
      baselineId,
      key,
      upperKey: key,
      uid: `uid-${key}`,
      title: `Requirement ${key} (frozen)`,
      bodyHtml: '<p>frozen</p>',
      bodySearch: 'frozen',
      anchorPath: '0',
      status: 'ACTIVE' as const,
      originVersionId: key === keyOf(0) ? undefined : restrictedVersion,
    })),
  });
  await prisma.baselineDanglingDependency.create({
    data: { baselineId, childKey: BR101, relationship: 'refines', targetKey: 'OUTSIDE-1' },
  });
  await snapshotGatesForBaseline(baselineId);

  // History, a pending link, a key conflict and a former key — each on a restricted row.
  await prisma.requirementHistory.create({
    data: { requirementId: ids.get(BR101)!, spaceId: fixture.spaceId, actorId: fixture.userId, changeKind: 'TITLE', before: { title: 'a' }, after: { title: 'b' } },
  });
  await prisma.unresolvedDependency.create({
    data: { childId: ids.get(keyOf(401))!, relationship: 'refines', targetSpaceKey: fixture.spaceKey, targetKey: 'NOPE-1' },
  });
  await prisma.indexDiagnostic.create({
    data: {
      documentId: fixture.restrictedDocumentId,
      code: 'KEY_CONFLICT',
      severity: 'error',
      message: 'conflict',
      path: '0',
      key: keyOf(402),
      relatedDocumentId: fixture.documentIds[0]!,
    },
  });
  await prisma.indexDiagnostic.create({
    data: {
      documentId: fixture.documentIds[0]!,
      code: 'KEY_CONFLICT',
      severity: 'error',
      message: 'conflict',
      path: '0',
      key: keyOf(402),
      relatedDocumentId: fixture.restrictedDocumentId,
    },
  });
  await prisma.requirementKeyAlias.create({
    data: { spaceId: fixture.spaceId, key: 'OLD-BR101', upperKey: 'OLD-BR101', requirementId: ids.get(BR101)!, actorId: fixture.userId },
  });

  // A type over BR-, so the type screen's counts are exercised.
  typeId = (
    await prisma.requirementType.create({
      data: { spaceId: fixture.spaceId, name: 'Business', keyPattern: 'BR-###' },
    })
  ).id;
  await prisma.requirement.updateMany({
    where: { spaceId: fixture.spaceId, baselineId: null, upperKey: { startsWith: 'BR-' } },
    data: { typeId },
  });
  await prisma.requirementValidation.createMany({
    data: [...ids.entries()]
      .filter(([key]) => key.startsWith('BR-'))
      .map(([, requirementId]) => ({ requirementId, typeId, status: 'TRUE' as const, messages: [] })),
  });
}, 180_000);

afterAll(async () => {
  await prisma.requirementValidation.deleteMany({ where: { typeId } });
  await prisma.requirement.updateMany({ where: { typeId }, data: { typeId: null } });
  await prisma.requirementType.deleteMany({ where: { id: typeId } });
  await prisma.requirementKeyAlias.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId: fixture.spaceId } } });
  await prisma.unresolvedDependency.deleteMany({ where: { child: { spaceId: fixture.spaceId } } });
  await prisma.requirementHistory.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.job.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.auditEvent.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.documentViewGate.deleteMany({ where: { document: { spaceId: fixture.spaceId } } });
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('the requirement page, popup and dependency panel', () => {
  it('answers a hidden requirement exactly as a missing one (RD-064)', async () => {
    expect(await findRequirementDetail(user, fixture.spaceId, BR101)).not.toBeNull();
    expect(await findRequirementDetail(stranger, fixture.spaceId, BR101)).toBeNull();
    expect(await findRequirementDetail(stranger, fixture.spaceId, 'NO-SUCH-KEY')).toBeNull();
  });

  it('shows a dependency on a hidden requirement as restricted: key kept, content gone (rule X2)', async () => {
    const seen = await findRequirementDetail(stranger, fixture.spaceId, FN101);
    expect(seen).not.toBeNull();
    const edge = edgesOf(seen!, fixture.spaceKey).find((candidate) => candidate.otherKey === BR101)!;
    expect(edge).toMatchObject({ restricted: true, otherTitle: 'restricted', otherStatus: 'RESTRICTED' });
    // Not merely relabelled: the hidden title is not in the object at all.
    expect(JSON.stringify(seen)).not.toContain(`Requirement ${BR101}`);

    const owner = await findRequirementDetail(user, fixture.spaceId, FN101);
    expect(edgesOf(owner!, fixture.spaceKey).find((candidate) => candidate.otherKey === BR101)?.restricted).toBe(false);
  });

  it('does not follow a former key to a hidden requirement', async () => {
    expect((await resolveKeyAlias(fixture.spaceId, 'OLD-BR101', user))?.currentKey).toBe(BR101);
    expect(await resolveKeyAlias(fixture.spaceId, 'OLD-BR101', stranger)).toBeNull();
  });

  it('lists only the snapshots the reader may see', async () => {
    expect((await baselinesContaining(user, fixture.spaceId, BR101)).map((row) => row.id)).toContain(baselineId);
    expect(await baselinesContaining(stranger, fixture.spaceId, BR101)).toEqual([]);
  });
});

describe('the picker', () => {
  it('never offers a hidden requirement to link to', async () => {
    actor = 'stranger';
    expect(hidden((await findRequirementsUseCase(fixture.spaceKey, 'BR-1')).map((row) => row.key))).toEqual([]);
    actor = 'user';
    expect(hidden((await findRequirementsUseCase(fixture.spaceKey, 'BR-10')).map((row) => row.key)).length).toBeGreaterThan(0);
  });
});

describe('the dependency matrix', () => {
  it('builds its axis from what the reader may see', async () => {
    actor = 'stranger';
    const seen = await runDependencyMatrixUseCase({ spaceKey: fixture.spaceKey, query: "key ~ 'BR-1%'" });
    actor = 'user';
    const owned = await runDependencyMatrixUseCase({ spaceKey: fixture.spaceKey, query: "key ~ 'BR-1%'" });
    if (!seen.ok || !owned.ok) throw new Error('the grid was refused');
    expect(hidden(seen.grid.axis.map((entry) => entry.key))).toEqual([]);
    expect(owned.population - seen.population).toBe(20);
  });
});

describe('the change log and per-requirement history', () => {
  it('omits the history of a hidden requirement, and does not count it', async () => {
    const mine = await listHistory({ viewer: user, spaceId: fixture.spaceId });
    const theirs = await listHistory({ viewer: stranger, spaceId: fixture.spaceId });
    expect(mine.map((row) => row.requirement.key)).toContain(BR101);
    expect(theirs.map((row) => row.requirement.key)).not.toContain(BR101);
  });
});

describe('broken links', () => {
  it('omits a pending link declared by a hidden requirement, and never names a hidden document', async () => {
    const mine = await listBrokenLinks(user, fixture.spaceId);
    const theirs = await listBrokenLinks(stranger, fixture.spaceId);
    expect(mine.unresolved.map((row) => row.child.key)).toContain(keyOf(401));
    expect(theirs.unresolved.map((row) => row.child.key)).not.toContain(keyOf(401));

    // The conflict half on the restricted document is dropped; the half on a visible
    // document stays but names the other one only as "a document you cannot see".
    expect(theirs.conflicts.map((row) => row.document.id)).not.toContain(fixture.restrictedDocumentId);
    const visibleHalf = theirs.conflicts.find((row) => row.key === keyOf(402));
    expect(visibleHalf?.relatedDocument).toEqual({ id: '', title: 'a document you cannot see' });
    expect(JSON.stringify(theirs)).not.toContain('Restricted annex');
  });
});

describe('the space overview and the type screen', () => {
  it('counts only what the reader may see (rule X2: not counted)', async () => {
    expect((await countRequirements(user, fixture.spaceId)) - (await countRequirements(stranger, fixture.spaceId))).toBe(20);
    expect((await countDocuments(user, fixture.spaceId)) - (await countDocuments(stranger, fixture.spaceId))).toBe(1);
    expect((await countRequirementsOfType(typeId, user)) - (await countRequirementsOfType(typeId, stranger))).toBe(20);
    const mine = (await countByStatusForSpace(user, fixture.spaceId)).get(typeId)!;
    const theirs = (await countByStatusForSpace(stranger, fixture.spaceId)).get(typeId)!;
    expect(mine.TRUE - theirs.TRUE).toBe(20);
  });
});

describe('baselines', () => {
  it('counts, lists and reports dangling edges only for members the reader may see (rules X2, X4)', async () => {
    const mine = (await listBaselines(user, fixture.spaceId)).find((row) => row.id === baselineId)!;
    const theirs = (await listBaselines(stranger, fixture.spaceId)).find((row) => row.id === baselineId)!;
    expect(mine.memberCount).toBe(6);
    expect(theirs.memberCount).toBe(1);
    expect(await countMembers(baselineId, stranger)).toBe(1);
    expect(hidden((await listMembers(stranger, baselineId)).map((row) => row.key))).toEqual([]);
    expect(hidden((await listMembers(user, baselineId)).map((row) => row.key))).toHaveLength(5);
    expect(await listDangling(stranger, baselineId)).toEqual([]);
    expect((await listDangling(user, baselineId)).map((row) => row.childKey)).toEqual([BR101]);
  });
});

describe('documents', () => {
  it('leaves a hidden document out of the tree', async () => {
    actor = 'stranger';
    const titles = (await documents.getDocumentTree(fixture.spaceKey)).map((node) => node.title);
    expect(titles).not.toContain('Restricted annex');
    actor = 'user';
    expect((await documents.getDocumentTree(fixture.spaceKey)).map((node) => node.title)).toContain('Restricted annex');
  });

  it('answers open, history and version on a hidden document as not found', async () => {
    actor = 'stranger';
    await expect(documents.openDocument(fixture.spaceKey, fixture.restrictedDocumentId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documents.documentHistory(fixture.spaceKey, fixture.restrictedDocumentId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documents.documentVersion(fixture.spaceKey, fixture.restrictedDocumentId, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documents.documentDiagnosticsUseCase(fixture.spaceKey, fixture.restrictedDocumentId)).rejects.toBeInstanceOf(NotFoundError);
    actor = 'user';
    expect((await documents.openDocument(fixture.spaceKey, fixture.restrictedDocumentId)).title).toBe('Restricted annex');
  });

  it('shows a visible document`s diagnostics without the half that lives on a hidden one', async () => {
    const theirs = await listDocumentDiagnostics(stranger, fixture.spaceId, fixture.documentIds[0]!);
    const mine = await listDocumentDiagnostics(user, fixture.spaceId, fixture.documentIds[0]!);
    expect(theirs.map((row) => row.documentId)).not.toContain(fixture.restrictedDocumentId);
    expect(mine.map((row) => row.documentId)).toContain(fixture.restrictedDocumentId);
  });
});

describe('reports', () => {
  it('does not name a hidden document as a place a visible requirement is cited', async () => {
    const citing = await prisma.requirement.findFirstOrThrow({
      where: { spaceId: fixture.spaceId, baselineId: null, upperKey: FN101 },
      select: { id: true },
    });
    const restrictedVersion = (await prisma.document.findUniqueOrThrow({
      where: { id: fixture.restrictedDocumentId },
      select: { currentVersionId: true },
    })).currentVersionId!;
    await prisma.documentLink.create({ data: { requirementId: citing.id, versionId: restrictedVersion, origin: false } });

    const theirs = await fetchReportData([citing.id], visibilityPredicate(stranger.userId, stranger.groupIds), stranger);
    const mine = await fetchReportData([citing.id], visibilityPredicate(user.userId, user.groupIds), user);
    expect(theirs.get(citing.id)!.documents.map((document) => document.title)).not.toContain('Restricted annex');
    expect(mine.get(citing.id)!.documents.map((document) => document.title)).toContain('Restricted annex');
  });
});

describe('export downloads', () => {
  it('serves an export only to the person who queued it', async () => {
    const job = await prisma.job.create({
      data: {
        kind: 'export-matrix',
        spaceId: fixture.spaceId,
        actorId: fixture.userId,
        payload: {},
        state: 'DONE',
        resultRef: 'exports/x/matrix.xlsx',
      },
    });
    actor = 'stranger';
    // Not found rather than forbidden: its existence is not confirmed either (RD-064).
    await expect(downloadExportUseCase(fixture.spaceKey, job.id)).rejects.toBeInstanceOf(NotFoundError);
    actor = 'user';
    expect(await downloadExportUseCase(fixture.spaceKey, job.id)).toEqual({ resultRef: 'exports/x/matrix.xlsx' });
    // spec 07 §6 — the download is audited.
    expect(await prisma.auditEvent.count({ where: { objectId: job.id, operation: 'download' } })).toBe(1);
  });
});
