import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';
import { countMembers, createDraft, findBaseline } from '@/server/repositories/baselines';
import { enqueueJob, findJob, requestCancel } from '@/server/repositories/jobs';
import { FREEZE_BATCH_SIZE } from '@/server/usecases/baselines';

/**
 * The freeze as a job: batching, progress, cancel and the run-time permission re-check.
 * spec: 05-baselines-and-diff.md §3.2 — "runs as a job with progress and cancel … steps
 * 3–5 batch in chunks of 500", because RY's docs name baseline creation as the operation
 * that exhausts the heap (research §6.7).
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
/** More than one batch, so the batching is exercised rather than described. */
const COUNT = FREEZE_BATCH_SIZE + 120;

let spaceId = '';
let spaceKey = '';
let userId = '';
let strangerId = '';
let memberKeys: string[] = [];

const key = (n: number) => `FZ${tag}-${String(n).padStart(4, '0')}`;

async function draft(name: string) {
  return createDraft({
    spaceId,
    name,
    sourceQuery: `key ~ 'FZ${tag}-%'`,
    includedDependencies: false,
    includedExternal: false,
    createdById: userId,
  });
}

async function queueFreeze(baselineId: string, actorId = userId) {
  registerJobHandlers();
  return enqueueJob({
    spaceId,
    kind: 'freeze-baseline',
    actorId,
    payload: {
      spaceKey,
      baselineId,
      memberKeys,
      includedExternal: false,
      batchSize: FREEZE_BATCH_SIZE,
      actorId,
    },
  });
}

describe('the freeze job (spec 05 §3.2)', () => {
  beforeAll(async () => {
    const [user, stranger] = await Promise.all([
      prisma.user.create({
        data: { email: `fz-${tag}@test`, name: 'Freezer', passwordHash: await hashPassword('x') },
      }),
      prisma.user.create({
        data: { email: `fzs-${tag}@test`, name: 'Stranger', passwordHash: await hashPassword('x') },
      }),
    ]);
    userId = user.id;
    strangerId = stranger.id;

    spaceKey = `FZ${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Freezing' } });
    spaceId = space.id;
    await prisma.membership.createMany({
      data: [
        { spaceId, userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
        // VIEW only: the job must refuse to run as someone who cannot administer.
        { spaceId, userId: strangerId, permissions: ['VIEW'] },
      ],
    });

    const document = await createDocument({ spaceId, title: 'Many', parentId: null, authorId: userId });
    const content = doc(
      table(
        row(th(para(text('Title'))), th(para(text('Key')))),
        ...Array.from({ length: COUNT }, (_, index) =>
          row(td(para(text(`Requirement ${index}.`))), td(para(marker(key(index))))),
        ),
      ),
    );

    const result = indexDocumentVersion({ content, space: { key: spaceKey } });
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
        });
      },
    });

    memberKeys = Array.from({ length: COUNT }, (_, index) => key(index).toUpperCase()).sort();
  }, 180_000);

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { spaceId } });
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
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  it('freezes a set larger than one batch, and freezes all of it', async () => {
    const baseline = await draft('Large');
    const job = await queueFreeze(baseline.id);
    await runJobNow(job.id);

    const finished = await findJob(job.id);
    expect(finished?.state).toBe('DONE');
    expect(finished?.progress).toBe(100);
    expect(finished?.message).toContain(`${COUNT} requirements`);

    expect(await countMembers(baseline.id)).toBe(COUNT);
    expect((await findBaseline(baseline.id))?.state).toBe('FROZEN');
  }, 180_000);

  it('pins every version behind the frozen rows exactly once', async () => {
    const pinned = await prisma.documentVersion.count({ where: { document: { spaceId }, pinned: true } });
    expect(pinned).toBeGreaterThan(0);
  });

  it('B1 through a cancel: the baseline stays a DRAFT owning no rows', async () => {
    const baseline = await draft('Cancelled');
    const job = await queueFreeze(baseline.id);
    await requestCancel(job.id, spaceId);
    await runJobNow(job.id);

    const finished = await findJob(job.id);
    expect(finished?.state).toBe('CANCELLED');
    // Invariant B1 — a draft owns no requirement rows, whatever happened on the way.
    expect(await countMembers(baseline.id)).toBe(0);
    expect((await findBaseline(baseline.id))?.state).toBe('DRAFT');
  }, 180_000);

  it('a re-run starts from an empty baseline rather than duplicating rows', async () => {
    const baseline = await draft('Twice');

    const first = await queueFreeze(baseline.id);
    await runJobNow(first.id);
    expect(await countMembers(baseline.id)).toBe(COUNT);

    const second = await queueFreeze(baseline.id);
    await runJobNow(second.id);
    expect(await countMembers(baseline.id)).toBe(COUNT);
  }, 180_000);

  it('refuses to run as someone who no longer administers the space (spec 07 §2.1)', async () => {
    const baseline = await draft('Not theirs');
    const job = await queueFreeze(baseline.id, strangerId);
    await runJobNow(job.id);

    const finished = await findJob(job.id);
    expect(finished?.state).toBe('FAILED');
    expect(finished?.error).toContain('no longer has ADMIN');
    expect(await countMembers(baseline.id)).toBe(0);
  }, 180_000);
});
