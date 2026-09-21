import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import type { Rule } from '@/domain/validation';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { enqueueJob, findJob, requestCancel } from '@/server/repositories/jobs';
import { applyIndexResult } from '@/server/repositories/requirements';
import { createType, listTypesWithRules, rulesOf, updateType } from '@/server/repositories/requirement-types';

/**
 * The revalidation job — spec 06 §2.2's second trigger, the one Requirement Yogi cannot
 * offer because its validation ran inside a page render (`RD-016`).
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
const COUNT = 25;

let spaceId = '';
let spaceKey = '';
let userId = '';
let strangerId = '';
let typeId = '';

const key = (n: number) => `RV${tag}-${String(n).padStart(3, '0')}`;

async function setRules(rules: Rule[]): Promise<void> {
  await updateType(spaceId, typeId, {
    name: 'Revalidated',
    keyPattern: `RV${tag}-###`,
    colour: '#4a5568',
    locked: false,
    preventReusingDeletedKeys: true,
    rules,
    templateColumns: [],
  });
}

async function queue(actorId = userId) {
  registerJobHandlers();
  return enqueueJob({
    spaceId,
    kind: 'revalidate-type',
    actorId,
    payload: { spaceKey, typeId, pageSize: 10 },
  });
}

const statuses = async () =>
  prisma.requirementValidation.groupBy({
    by: ['status'],
    where: { typeId },
    _count: { _all: true },
  });

describe('the revalidation job (spec 06 §2.2 trigger 2)', () => {
  beforeAll(async () => {
    const [user, stranger] = await Promise.all([
      prisma.user.create({
        data: { email: `rv-${tag}@test`, name: 'Runner', passwordHash: await hashPassword('x') },
      }),
      prisma.user.create({
        data: { email: `rvs-${tag}@test`, name: 'Stranger', passwordHash: await hashPassword('x') },
      }),
    ]);
    userId = user.id;
    strangerId = stranger.id;

    spaceKey = `RV${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Revalidation' } });
    spaceId = space.id;
    await prisma.membership.createMany({
      data: [
        { spaceId, userId, permissions: ['VIEW', 'EDIT', 'ADMIN'] },
        // VIEW only: the job must refuse to run as someone who cannot edit.
        { spaceId, userId: strangerId, permissions: ['VIEW'] },
      ],
    });

    const type = await createType(spaceId, {
      name: 'Revalidated',
      keyPattern: `RV${tag}-###`,
      colour: '#4a5568',
      locked: false,
      preventReusingDeletedKeys: true,
      rules: [],
      templateColumns: [],
    });
    typeId = type.id;

    // Requirements with a Status, written before any rule exists.
    const document = await createDocument({ spaceId, title: 'Body', parentId: null, authorId: userId });
    const content = doc(
      table(
        row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('Key')))),
        ...Array.from({ length: COUNT }, (_, index) =>
          row(td(para(text(`Requirement ${index}.`))), td(para(text('Draft'))), td(para(marker(key(index))))),
        ),
      ),
    );

    const types = await listTypesWithRules(spaceId);
    const result = indexDocumentVersion({ content, space: { key: spaceKey, types } });
    await saveDocumentVersion({
      documentId: document.id,
      content,
      authorId: userId,
      onVersion: async (tx, version) => {
        await applyIndexResult(tx, {
          spaceId,
          spaceKey,
          documentId: document.id,
          versionId: version.id,
          actorId: userId,
          result,
          types: types.map((entry) => ({ id: entry.id, rules: rulesOf(entry) })),
        });
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { spaceId } });
    await prisma.requirementValidation.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.requirementType.deleteMany({ where: { spaceId } });
    await prisma.membership.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  it('nothing is validated until a rule exists', async () => {
    expect(await statuses()).toEqual([]);
  });

  it('a rule change revalidates the whole type without re-saving a document', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Priority' }]);

    const job = await queue();
    await runJobNow(job.id);

    const finished = await findJob(job.id);
    expect(finished?.state).toBe('DONE');
    expect(finished?.progress).toBe(100);
    expect(finished?.message).toContain(`${COUNT} requirements`);

    const counts = await statuses();
    // Every requirement now fails the new rule — and no document was touched.
    expect(counts).toEqual([{ status: 'FALSE', _count: { _all: COUNT } }]);
  }, 120_000);

  it('a second run with a satisfiable rule turns them all green', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Status' }]);
    const job = await queue();
    await runJobNow(job.id);

    expect(await statuses()).toEqual([{ status: 'TRUE', _count: { _all: COUNT } }]);
  }, 120_000);

  it('reports progress as it pages, rather than only at the end', async () => {
    await setRules([{ kind: 'OPTIONAL_PROPERTY', name: 'Rationale' }]);
    const job = await queue();

    const seen: number[] = [];
    const watching = setInterval(async () => {
      const current = await findJob(job.id);
      if (current) seen.push(current.progress);
    }, 5);

    await runJobNow(job.id);
    clearInterval(watching);

    expect((await findJob(job.id))?.progress).toBe(100);
    expect(await statuses()).toEqual([{ status: 'WARNING', _count: { _all: COUNT } }]);
  }, 120_000);

  it('stops at a cancel request rather than finishing the run', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Priority' }]);
    const job = await queue();
    await requestCancel(job.id, spaceId);
    await runJobNow(job.id);

    expect((await findJob(job.id))?.state).toBe('CANCELLED');
    // The work already done stays done — the results are written page by page.
    expect(await statuses()).toEqual([{ status: 'WARNING', _count: { _all: COUNT } }]);
  }, 120_000);

  it('refuses to run as someone who may no longer edit the space (spec 06 §5)', async () => {
    const job = await queue(strangerId);
    await runJobNow(job.id);

    const finished = await findJob(job.id);
    expect(finished?.state).toBe('FAILED');
    expect(finished?.error).toContain('no longer has EDIT');
  }, 120_000);
});
