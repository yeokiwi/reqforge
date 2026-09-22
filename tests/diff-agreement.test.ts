import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyPair,
  DEFAULT_COMPARE,
  DEFAULT_IGNORE,
  type ComparableRow,
} from '@/domain/diff';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { parseAndAnalyse } from '@/domain/ryql';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { createDraft } from '@/server/repositories/baselines';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { enqueueJob } from '@/server/repositories/jobs';
import { applyIndexResult } from '@/server/repositories/requirements';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { loadComparable } from '@/server/usecases/diff';
import { FREEZE_BATCH_SIZE } from '@/server/usecases/baselines';

/**
 * **Slice 14's acceptance, from PLAN.md**: "`isModified(N)` and the diff view never
 * disagree on the same pair — a property-based test asserts exactly that."
 *
 * `isModified()` is SQL over stored columns; the diff classifier is TypeScript. `RD-047`
 * keeps them in step by defining both over the same three things — title, `bodySearch`
 * and the inline property set. This test is what makes that a fact rather than a claim:
 * fast-check generates mutations, and shrinking names the exact pair if they ever part.
 */

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const COUNT = 8;

let spaceId = '';
let spaceKey = '';
let userId = '';
let documentId = '';
let baselineNumber = 0;

const key = (n: number) => `AG${tag}-${String(n).padStart(3, '0')}`;

/** One requirement per row: a title cell, a Status cell and the marker. */
function documentOf(rows: ReadonlyArray<{ title: string; status: string }>): PMNode {
  return doc(
    table(
      row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('Key')))),
      ...rows.map((entry, index) =>
        row(td(para(text(entry.title))), td(para(text(entry.status))), td(para(marker(key(index))))),
      ),
    ),
  );
}

async function save(content: PMNode) {
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

/** What `isModified(N)` returns, through the real compiler and the real database. */
async function isModifiedKeys(): Promise<string[]> {
  const analysed = parseAndAnalyse(`isModified(${baselineNumber})`, { spaceKey, isolated: false });
  if (!analysed.ok) throw new Error(analysed.errors[0]?.message);

  const ids = await runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
  });
  const rows = await prisma.requirement.findMany({ where: { id: { in: ids } }, select: { upperKey: true } });
  return rows.map((requirement) => requirement.upperKey).sort();
}

/** What the diff classifier calls modified, over the same two sides. */
async function classifierKeys(): Promise<string[]> {
  const snapshot = await prisma.requirement.findMany({
    where: { spaceId, baseline: { number: baselineNumber } },
    select: { id: true },
  });
  const live = await prisma.requirement.findMany({
    where: { spaceId, baselineId: null, status: 'ACTIVE' },
    select: { id: true },
  });

  const [before, after] = await Promise.all([
    loadComparable(snapshot.map((requirement) => requirement.id)),
    loadComparable(live.map((requirement) => requirement.id)),
  ]);

  const left = new Map<string, ComparableRow>(before.map((entry) => [entry.key.toUpperCase(), entry]));
  const modified: string[] = [];

  for (const right of after) {
    const pair = classifyPair(left.get(right.key.toUpperCase()), right, DEFAULT_COMPARE, DEFAULT_IGNORE);
    if (pair.kind === 'modified') modified.push(right.key.toUpperCase());
  }
  return modified.sort();
}

describe('isModified() and the diff never disagree (RD-047)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `ag-${tag}@test`, name: 'Agreement', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `AG${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Agreement' } });
    spaceId = space.id;
    await prisma.membership.create({ data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'ADMIN'] } });

    const document = await createDocument({ spaceId, title: 'Source', parentId: null, authorId: userId });
    documentId = document.id;

    await save(
      documentOf(Array.from({ length: COUNT }, (_, index) => ({ title: `Title ${index}`, status: 'Draft' }))),
    );

    // Freeze the lot: that snapshot is the "before" both implementations read.
    const baseline = await createDraft({
      spaceId,
      name: 'Agreed',
      sourceQuery: `key ~ 'AG${tag}-%'`,
      includedDependencies: false,
      includedExternal: false,
      createdById: userId,
    });
    baselineNumber = baseline.number;

    registerJobHandlers();
    const job = await enqueueJob({
      spaceId,
      kind: 'freeze-baseline',
      actorId: userId,
      payload: {
        spaceKey,
        baselineId: baseline.id,
        memberKeys: Array.from({ length: COUNT }, (_, index) => key(index).toUpperCase()),
        includedExternal: false,
        batchSize: FREEZE_BATCH_SIZE,
        actorId: userId,
      },
    });
    await runJobNow(job.id);

    const frozen = await prisma.requirement.count({ where: { baseline: { number: baselineNumber }, spaceId } });
    expect(frozen).toBe(COUNT);
  }, 180_000);

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { spaceId } });
    await prisma.auditEvent.deleteMany({ where: { spaceId } });
    await prisma.requirementHistory.deleteMany({ where: { spaceId } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.baseline.deleteMany({ where: { spaceId } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentVersion.updateMany({ where: { document: { spaceId } }, data: { pinned: false } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.membership.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('nothing is modified before anything is edited', async () => {
    expect(await isModifiedKeys()).toEqual([]);
    expect(await classifierKeys()).toEqual([]);
  });

  it('agree on every generated mutation of titles and property values', async () => {
    /** Per requirement: keep it, retitle it, or change its Status — or do both. */
    const mutation = fc.record({
      retitle: fc.boolean(),
      restatus: fc.boolean(),
      // Whitespace-only edits must *not* count: bodySearch collapses them (RD-047).
      pad: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(mutation, { minLength: COUNT, maxLength: COUNT }), async (mutations) => {
        await save(
          documentOf(
            mutations.map((change, index) => ({
              title: `${change.retitle ? `Retitled ${index}` : `Title ${index}`}${change.pad ? '  ' : ''}`,
              status: change.restatus ? 'Approved' : 'Draft',
            })),
          ),
        );

        const [fromSql, fromClassifier] = await Promise.all([isModifiedKeys(), classifierKeys()]);
        expect(fromSql).toEqual(fromClassifier);

        // And the answer is the one the mutations imply: padding alone is not a change.
        const expected = mutations
          .map((change, index) => (change.retitle || change.restatus ? key(index).toUpperCase() : null))
          .filter((entry): entry is string => entry !== null)
          .sort();
        expect(fromSql).toEqual(expected);
      }),
      { numRuns: 12 },
    );
  }, 180_000);

  it('agree that a requirement absent from the baseline is not modified (spec 05 §5.3)', async () => {
    // A ninth requirement, written after the freeze: new, not modified.
    await save(
      documentOf([
        ...Array.from({ length: COUNT }, (_, index) => ({ title: `Title ${index}`, status: 'Draft' })),
        { title: 'Written after the freeze', status: 'Draft' },
      ]),
    );

    const [fromSql, fromClassifier] = await Promise.all([isModifiedKeys(), classifierKeys()]);
    expect(fromSql).toEqual(fromClassifier);
    expect(fromSql).not.toContain(key(COUNT).toUpperCase());

    // It is found the way spec 05 §5.3 says: NOT (baseline was N).
    const analysed = parseAndAnalyse(`NOT (baseline was ${baselineNumber})`, { spaceKey, isolated: false });
    if (!analysed.ok) throw new Error(analysed.errors[0]?.message);
    const ids = await runSearchIds(analysed.query.expr, {
      visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
    });
    const rows = await prisma.requirement.findMany({ where: { id: { in: ids } }, select: { upperKey: true } });
    expect(rows.map((requirement) => requirement.upperKey)).toContain(key(COUNT).toUpperCase());
  }, 180_000);
});
