import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';
import {
  countMembers,
  createDraft,
  frozenMemberKeys,
  listRevisions,
  recordRevision,
  requireFrozen,
} from '@/server/repositories/baselines';
import { enqueueJob } from '@/server/repositories/jobs';
import { FREEZE_BATCH_SIZE } from '@/server/usecases/baselines';

/**
 * Refreeze — spec 05 §3.4, `RD-044`. "Add, remove or update members of an existing frozen
 * baseline. Implemented as delete + re-insert of the affected rows in one transaction,
 * with a `BaselineRevision` audit row recording who, when, why and the before/after
 * member counts … the revision history is not erasable."
 *
 * Delete + re-insert is not a workaround for the invariant-R2 trigger; it is the only
 * shape a correction may take, which is what makes a frozen baseline auditable.
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

let spaceId = '';
let spaceKey = '';
let userId = '';
let baselineId = '';

const key = (n: number) => `RF${tag}-${String(n).padStart(3, '0')}`;

async function freezeWith(memberKeys: string[]) {
  registerJobHandlers();
  const job = await enqueueJob({
    spaceId,
    kind: 'freeze-baseline',
    actorId: userId,
    payload: {
      spaceKey,
      baselineId,
      memberKeys,
      includedExternal: false,
      batchSize: FREEZE_BATCH_SIZE,
      actorId: userId,
    },
  });
  await runJobNow(job.id);
  return prisma.job.findUniqueOrThrow({ where: { id: job.id } });
}

describe('refreeze (spec 05 §3.4)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `rf-${tag}@test`, name: 'Reviser', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `RF${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Refreezing' } });
    spaceId = space.id;
    await prisma.membership.create({ data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'ADMIN'] } });

    const document = await createDocument({ spaceId, title: 'Members', parentId: null, authorId: userId });
    const content = doc(
      table(
        row(th(para(text('Title'))), th(para(text('Key')))),
        ...[1, 2, 3, 4].map((n) => row(td(para(text(`Requirement ${n}.`))), td(para(marker(key(n)))))),
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

    const baseline = await createDraft({
      spaceId,
      name: 'Revisable',
      sourceQuery: `key ~ 'RF${tag}-%'`,
      includedDependencies: false,
      includedExternal: false,
      createdById: userId,
    });
    baselineId = baseline.id;
  }, 120_000);

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { spaceId } });
    await prisma.baselineRevision.deleteMany({ where: { baselineId } });
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

  it('a draft cannot be refrozen — there is nothing to revise yet', async () => {
    await expect(requireFrozen(spaceId, baselineId)).rejects.toThrow(/still a draft/);
  });

  it('freezes two members to begin with', async () => {
    await freezeWith([key(1), key(2)].map((k) => k.toUpperCase()));
    expect(await countMembers(baselineId)).toBe(2);
    expect(await frozenMemberKeys(baselineId)).toEqual([key(1).toUpperCase(), key(2).toUpperCase()]);
  });

  it('a refreeze adds and removes members, and the rows are replaced not updated', async () => {
    const before = await frozenMemberKeys(baselineId);
    const after = [key(2), key(3), key(4)].map((k) => k.toUpperCase());

    await recordRevision({
      baselineId,
      actorId: userId,
      reason: 'The scope review moved BL-1 out and pulled BL-3 and BL-4 in.',
      countBefore: before.length,
      countAfter: after.length,
      detail: {
        added: after.filter((k) => !before.includes(k)),
        removed: before.filter((k) => !after.includes(k)),
      },
    });
    await freezeWith(after);

    expect(await frozenMemberKeys(baselineId)).toEqual(after);
    expect(await countMembers(baselineId)).toBe(3);
  });

  it('records who, when, why and the before/after counts (spec 05 §3.4)', async () => {
    const [revision] = await listRevisions(baselineId);

    expect(revision).toMatchObject({ actorId: userId, countBefore: 2, countAfter: 3 });
    expect(revision?.reason).toContain('scope review');
    expect(revision?.at).toBeInstanceOf(Date);
    expect(revision?.detail).toMatchObject({
      added: [key(3).toUpperCase(), key(4).toUpperCase()],
      removed: [key(1).toUpperCase()],
    });
  });

  it('the revision history accumulates rather than being overwritten', async () => {
    await recordRevision({
      baselineId,
      actorId: userId,
      reason: 'A second correction.',
      countBefore: 3,
      countAfter: 3,
      detail: { added: [], removed: [] },
    });

    const revisions = await listRevisions(baselineId);
    expect(revisions).toHaveLength(2);
    // Newest first, so the screen shows the latest correction at the top.
    expect(revisions[0]?.reason).toBe('A second correction.');
    expect(revisions[1]?.reason).toContain('scope review');
  });

  it('a refrozen baseline is still FROZEN, and its number never moved', async () => {
    const baseline = await prisma.baseline.findUniqueOrThrow({ where: { id: baselineId } });
    expect(baseline.state).toBe('FROZEN');
    expect(baseline.name).toBe('Revisable');
    // spec 05 §4 — the number is immutable; only the name is renameable.
    expect(baseline.number).toBe(1);
  });

  it('the rows a refreeze wrote are as immutable as the first freeze (invariant R2)', async () => {
    const frozen = await prisma.requirement.findFirstOrThrow({ where: { baselineId } });
    await expect(
      prisma.$executeRawUnsafe('UPDATE "Requirement" SET title = $1 WHERE id = $2', 'tampered', frozen.id),
    ).rejects.toThrow();
  });
});
