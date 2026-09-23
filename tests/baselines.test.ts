import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { parseAndAnalyse } from '@/domain/ryql';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { resetImageFetcher, setImageFetcher } from '@/server/jobs/handlers/freeze';
import { runJobNow } from '@/server/jobs/runner';
import { readStoredImage } from '@/server/images/store';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';
import { countMembers, createDraft, findBaseline } from '@/server/repositories/baselines';
import { enqueueJob } from '@/server/repositories/jobs';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { FREEZE_BATCH_SIZE } from '@/server/usecases/baselines';
import { SYSTEM } from '@/server/repositories/visibility';

/**
 * Slice 13's acceptance, from PLAN.md: invariants B1, B2 and R2 — R2 by attempting an
 * update through raw SQL and expecting the trigger to reject it; a pinned document
 * version cannot be deleted; a frozen body's images resolve after the source is replaced.
 * spec: 05-baselines-and-diff.md §2–4, §7
 */

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string): PMNode => ({ type: 'requirementLink', attrs: { key } });
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;

let spaceId = '';
let spaceKey = '';
let userId = '';
let documentId = '';

const key = (n: number) => `BL${tag}-${String(n).padStart(3, '0')}`;

async function save(content: PMNode, target = documentId) {
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId: target,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, {
        spaceId,
        spaceKey,
        documentId: target,
        versionId: version.id,
        actorId: userId,
        result,
      });
    },
  });
}

/** Freezes through the job, as the app does, and returns the finished job. */
async function freeze(baselineId: string, memberKeys: string[], includedExternal = false) {
  registerJobHandlers();
  const job = await enqueueJob({
    spaceId,
    kind: 'freeze-baseline',
    actorId: userId,
    payload: {
      spaceKey,
      baselineId,
      memberKeys,
      includedExternal,
      batchSize: FREEZE_BATCH_SIZE,
      actorId: userId,
    },
  });
  await runJobNow(job.id);
  return prisma.job.findUniqueOrThrow({ where: { id: job.id } });
}

async function draft(name: string, query: string) {
  return createDraft({
    spaceId,
    name,
    sourceQuery: query,
    includedDependencies: false,
    includedExternal: false,
    createdById: userId,
  });
}

async function keysMatching(query: string): Promise<string[]> {
  const analysed = parseAndAnalyse(query, { spaceKey, isolated: false });
  if (!analysed.ok) throw new Error(analysed.errors[0]?.message);
  const ids = await runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
  });
  const rows = await prisma.requirement.findMany({ where: { id: { in: ids } }, select: { key: true } });
  return rows.map((requirement) => requirement.key).sort();
}

describe('baselines: draft, freeze and the invariants that make them hold', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `bl-${tag}@test`, name: 'Baseliner', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `BL${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Baselines' } });
    spaceId = space.id;
    await prisma.membership.create({
      data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
    });

    const document = await createDocument({ spaceId, title: 'Source', parentId: null, authorId: userId });
    documentId = document.id;

    // Three requirements, the third depending on the second, plus a Status property.
    await save(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('satisfies'))), th(para(text('Key')))),
          row(td(para(text('One.'))), td(para(text('Draft'))), td(para()), td(para(marker(key(1))))),
          row(td(para(text('Two.'))), td(para(text('Draft'))), td(para()), td(para(marker(key(2))))),
          row(td(para(text('Three.'))), td(para(text('Draft'))), td(para(link(key(2)))), td(para(marker(key(3))))),
        ),
      ),
    );
  }, 120_000);

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { spaceId } });
    await prisma.auditEvent.deleteMany({ where: { spaceId } });
    await prisma.requirementValidation.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.$executeRawUnsafe(
      'DELETE FROM "Dependency" WHERE "childId" IN (SELECT id FROM "Requirement" WHERE "spaceId" = $1)',
      spaceId,
    );
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.baseline.deleteMany({ where: { spaceId } });
    // Unpin before deleting, or the trigger of spec 05 §7.2 refuses — which is the point.
    await prisma.documentVersion.updateMany({ where: { document: { spaceId } }, data: { pinned: false } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.membership.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // --- invariant B1 ---------------------------------------------------------------------

  it('B1: a DRAFT owns no requirement rows', async () => {
    const baseline = await draft('Draft only', `key ~ 'BL${tag}-%'`);
    expect(baseline.state).toBe('DRAFT');
    expect(await countMembers(baseline.id, SYSTEM)).toBe(0);
  });

  // --- the freeze -----------------------------------------------------------------------

  it('materialises the member rows in one run, ARCHIVED and immutable', async () => {
    const baseline = await draft('Release 1.0', `key ~ 'BL${tag}-%'`);
    const job = await freeze(baseline.id, [key(1), key(2), key(3)].map((k) => k.toUpperCase()));

    expect(job.state).toBe('DONE');
    expect(job.progress).toBe(100);
    expect(await countMembers(baseline.id, SYSTEM)).toBe(3);

    const frozen = await prisma.requirement.findMany({ where: { baselineId: baseline.id } });
    expect(frozen.every((requirement) => requirement.status === 'ARCHIVED')).toBe(true);
    expect((await findBaseline(baseline.id))?.state).toBe('FROZEN');
    expect((await findBaseline(baseline.id))?.frozenById).toBe(userId);
  });

  it('is findable by number and by name, with no ACTIVE filter injected (spec 02 §8 rule 4)', async () => {
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { spaceId, name: 'Release 1.0' } });

    expect(await keysMatching(`baseline = ${baseline.number}`)).toEqual([key(1), key(2), key(3)]);
    expect(await keysMatching("baseline = 'Release 1.0'")).toHaveLength(3);
    // The live rows are still the ones a plain query finds.
    expect(await keysMatching(`key ~ 'BL${tag}-%'`)).toEqual([key(1), key(2), key(3)]);
  });

  it('copies inline properties and the dependencies wholly inside the baseline', async () => {
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { spaceId, name: 'Release 1.0' } });
    const frozen = await prisma.requirement.findMany({
      where: { baselineId: baseline.id },
      include: { properties: true, parentEdges: true },
    });

    const three = frozen.find((requirement) => requirement.upperKey === key(3).toUpperCase())!;
    expect(three.properties.map((property) => property.name)).toContain('Status');
    // BL-3 satisfies BL-2, and both are members, so the edge is copied between the
    // frozen rows rather than pointing back at the live ones (spec 05 §3.2 step 5).
    expect(three.parentEdges).toHaveLength(1);
    const parent = await prisma.requirement.findUniqueOrThrow({ where: { id: three.parentEdges[0]!.parentId } });
    expect(parent.baselineId).toBe(baseline.id);
  });

  it('does not move when the live requirement changes — the whole point', async () => {
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { spaceId, name: 'Release 1.0' } });

    await save(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('satisfies'))), th(para(text('Key')))),
          row(td(para(text('One, rewritten.'))), td(para(text('Approved'))), td(para()), td(para(marker(key(1))))),
          row(td(para(text('Two.'))), td(para(text('Draft'))), td(para()), td(para(marker(key(2))))),
          row(td(para(text('Three.'))), td(para(text('Draft'))), td(para(link(key(2)))), td(para(marker(key(3))))),
        ),
      ),
    );

    const live = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, baselineId: null, upperKey: key(1).toUpperCase() },
    });
    const snapshot = await prisma.requirement.findFirstOrThrow({
      where: { baselineId: baseline.id, upperKey: key(1).toUpperCase() },
    });

    expect(live.title).toBe('One, rewritten.');
    expect(snapshot.title).toBe('One.');
  });

  // --- invariant R2, at the database level ----------------------------------------------

  it('R2: the database rejects an UPDATE of a frozen row, not just the application', async () => {
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { spaceId, name: 'Release 1.0' } });
    const frozen = await prisma.requirement.findFirstOrThrow({ where: { baselineId: baseline.id } });

    await expect(
      prisma.$executeRawUnsafe('UPDATE "Requirement" SET title = $1 WHERE id = $2', 'tampered', frozen.id),
    ).rejects.toThrow();

    const after = await prisma.requirement.findUniqueOrThrow({ where: { id: frozen.id } });
    expect(after.title).not.toBe('tampered');
  });

  it('R2 leaves live rows alone — the trigger is conditional, not a blanket ban', async () => {
    const live = await prisma.requirement.findFirstOrThrow({ where: { spaceId, baselineId: null } });
    await expect(
      prisma.requirement.update({ where: { id: live.id }, data: { title: live.title } }),
    ).resolves.toBeTruthy();
  });

  // --- pinning, spec 05 §3.2 step 6 and §7.2 ---------------------------------------------

  it('pins the versions behind frozen rows, and the database refuses to delete them', async () => {
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { spaceId, name: 'Release 1.0' } });
    const frozen = await prisma.requirement.findFirstOrThrow({
      where: { baselineId: baseline.id, originVersionId: { not: null } },
    });

    const version = await prisma.documentVersion.findUniqueOrThrow({ where: { id: frozen.originVersionId! } });
    expect(version.pinned).toBe(true);

    // research §5.3 leak 3: RY cannot stop Confluence deleting the page version under it.
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "DocumentVersion" WHERE id = $1', version.id),
    ).rejects.toThrow();
    await expect(prisma.documentVersion.findUnique({ where: { id: version.id } })).resolves.not.toBeNull();
  });

  it('leaves an unpinned version deletable', async () => {
    const spare = await createDocument({ spaceId, title: 'Spare', parentId: null, authorId: userId });
    const version = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: spare.id } });
    await prisma.document.update({ where: { id: spare.id }, data: { currentVersionId: null } });
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "DocumentVersion" WHERE id = $1', version.id),
    ).resolves.toBeDefined();
  });

  // --- invariant B2 -----------------------------------------------------------------------

  it('B2: numbers are sequential per space', async () => {
    const first = await draft('Numbering A', `key = '${key(1)}'`);
    const second = await draft('Numbering B', `key = '${key(1)}'`);
    expect(second.number).toBe(first.number + 1);
  });

  it('B2: a deleted baseline never gives its number back', async () => {
    const doomed = await draft('Doomed', `key = '${key(1)}'`);
    const number = doomed.number;
    await prisma.baseline.delete({ where: { id: doomed.id } });

    // The number comes from a counter that only moves forward, not from max(number) over
    // what remains — otherwise two snapshots could both be cited as "baseline N".
    const next = await draft('After the deletion', `key = '${key(1)}'`);
    expect(next.number).toBeGreaterThan(number);
  });

  it('B2: the number a space will hand out next survives an emptied baseline table', async () => {
    const before = await prisma.space.findUniqueOrThrow({ where: { id: spaceId } });
    await prisma.baseline.deleteMany({ where: { spaceId, state: 'DRAFT', name: { startsWith: 'Numbering' } } });
    const after = await prisma.space.findUniqueOrThrow({ where: { id: spaceId } });

    expect(after.nextBaselineNumber).toBe(before.nextBaselineNumber);
  });

  it('deleting a baseline takes its frozen rows and leaves the live ones', async () => {
    const baseline = await draft('Disposable', `key = '${key(1)}'`);
    await freeze(baseline.id, [key(1).toUpperCase()]);
    expect(await countMembers(baseline.id, SYSTEM)).toBe(1);

    await prisma.baseline.delete({ where: { id: baseline.id } });

    expect(await prisma.requirement.count({ where: { baselineId: baseline.id } })).toBe(0);
    // The live row is untouched: the cascade follows the baseline, nothing else.
    expect(
      await prisma.requirement.count({ where: { spaceId, baselineId: null, upperKey: key(1).toUpperCase() } }),
    ).toBe(1);
  });

  // --- RD-010 -----------------------------------------------------------------------------

  it('copies external properties only when the freeze asked for them (RD-010)', async () => {
    const definition = await prisma.externalPropertyDefinition.create({
      data: { name: `Approval ${tag}`, dataType: 'STRING', enumValues: [] },
    });
    const live = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, baselineId: null, upperKey: key(1).toUpperCase() },
    });
    await prisma.property.create({
      data: {
        requirementId: live.id,
        kind: 'EXTERNAL',
        name: 'Approval',
        searchName: 'approval',
        value: 'Signed off',
        definitionId: definition.id,
      },
    });

    const without = await draft('Without external', `key = '${key(1)}'`);
    await freeze(without.id, [key(1).toUpperCase()], false);
    const plain = await prisma.property.findMany({
      where: { requirement: { baselineId: without.id }, kind: 'EXTERNAL' },
    });
    expect(plain).toHaveLength(0);

    const with_ = await draft('With external', `key = '${key(1)}'`);
    await freeze(with_.id, [key(1).toUpperCase()], true);
    const copied = await prisma.property.findMany({
      where: { requirement: { baselineId: with_.id }, kind: 'EXTERNAL' },
    });
    expect(copied).toHaveLength(1);
    expect(copied[0]!.value).toBe('Signed off');

    await prisma.baseline.deleteMany({ where: { id: { in: [without.id, with_.id] } } });
    await prisma.property.deleteMany({ where: { definitionId: definition.id } });
    await prisma.externalPropertyDefinition.delete({ where: { id: definition.id } });
  });

  // --- images, spec 05 §3.2 step 7 and RD-012 ----------------------------------------------

  it('materialises an image, so the frozen body survives the source being replaced', async () => {
    const source = 'https://pictures.test/diagram.png';
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const replacement = new Uint8Array([9, 9, 9]);

    let serving = original;
    setImageFetcher(async () => ({ ok: true, bytes: serving, mediaType: 'image/png' }));

    try {
      const document = await createDocument({ spaceId, title: 'Illustrated', parentId: null, authorId: userId });
      await save(
        doc(
          para(marker(key(9)), text(' A requirement with a picture. '), {
            type: 'image',
            attrs: { src: source, alt: 'Diagram' },
          }),
        ),
        document.id,
      );

      const live = await prisma.requirement.findFirstOrThrow({
        where: { spaceId, baselineId: null, upperKey: key(9).toUpperCase() },
      });
      expect(live.bodyHtml).toContain(source);

      const baseline = await draft('Illustrated release', `key = '${key(9)}'`);
      await freeze(baseline.id, [key(9).toUpperCase()]);

      const frozen = await prisma.requirement.findFirstOrThrow({
        where: { baselineId: baseline.id, upperKey: key(9).toUpperCase() },
      });

      // The frozen body points at a digest under this space, not at the internet.
      expect(frozen.bodyHtml).not.toContain(source);
      const stored = /\/s\/[^/]+\/images\/([0-9a-f]{64}\.[a-z0-9]+)/.exec(frozen.bodyHtml);
      expect(stored?.[1], frozen.bodyHtml).toBeTruthy();

      // Whoever owns that URL now serves something else entirely — research §5.3 leak 2.
      serving = replacement;

      const bytes = await readStoredImage(stored![1]!);
      expect(bytes).not.toBeNull();
      expect(Array.from(bytes!.bytes)).toEqual(Array.from(original));

      // And the frozen body still names the same digest: a different image would be a
      // different URL, which is what content addressing buys.
      const reread = await prisma.requirement.findFirstOrThrow({ where: { id: frozen.id } });
      expect(reread.bodyHtml).toContain(stored![1]!);
    } finally {
      resetImageFetcher();
    }
  });

  it('refuses to freeze when an image cannot be materialised, naming it (RD-043)', async () => {
    setImageFetcher(async () => ({ ok: false, reason: 'pictures.test resolves to 10.0.0.5, which is not a public address.' }));

    try {
      const baseline = await draft('Unfreezable', `key = '${key(9)}'`);
      const job = await freeze(baseline.id, [key(9).toUpperCase()]);

      expect(job.state).toBe('FAILED');
      expect(job.error).toContain('not a public address');
      // A failed freeze leaves the baseline a DRAFT owning no rows (invariant B1).
      expect((await findBaseline(baseline.id))?.state).toBe('DRAFT');
      expect(await countMembers(baseline.id, SYSTEM)).toBe(0);
    } finally {
      resetImageFetcher();
    }
  });

  // --- dangling dependencies, spec 05 §3.2 step 5 ------------------------------------------

  it('records a dependency pointing outside the baseline rather than dropping it', async () => {
    // Only BL-3 is a member; it satisfies BL-2, which is not.
    const baseline = await draft('Partial', `key = '${key(3)}'`);
    await freeze(baseline.id, [key(3).toUpperCase()]);

    const dangling = await prisma.baselineDanglingDependency.findMany({ where: { baselineId: baseline.id } });
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({
      childKey: key(3).toUpperCase(),
      targetKey: key(2).toUpperCase(),
      relationship: 'satisfies',
    });

    // And no edge was written into the baseline for it.
    const frozen = await prisma.requirement.findFirstOrThrow({ where: { baselineId: baseline.id } });
    expect(await prisma.dependency.count({ where: { childId: frozen.id } })).toBe(0);
  });
});
