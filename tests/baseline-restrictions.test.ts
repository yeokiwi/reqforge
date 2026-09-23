import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { createDraft } from '@/server/repositories/baselines';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { enqueueJob } from '@/server/repositories/jobs';
import { applyIndexResult } from '@/server/repositories/requirements';
import { setRestriction } from '@/server/repositories/restrictions';
import { visibleRequirementIdsFor, viewerFor } from '@/server/repositories/visibility';

/**
 * Rule X4. spec: 07-permissions-and-limits.md §2.2 — "A frozen baseline captures the
 * restriction state at freeze time. Loosening a document's restrictions later does not
 * retroactively expose baselined text; tightening them does apply to the baseline."
 * RD-059: a frozen row must pass the gates as they stood at freeze *and* as they stand now.
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const KEY = `XF${tag}-001`;

let spaceId = '';
let spaceKey = '';
let owner = '';
let insider = '';
let outsider = '';
let documentId = '';
let baselineId = '';

const frozenIds = async () =>
  (await prisma.requirement.findMany({ where: { baselineId }, select: { id: true } })).map((row) => row.id);
const liveIds = async () =>
  (await prisma.requirement.findMany({ where: { spaceId, baselineId: null }, select: { id: true } })).map((row) => row.id);
const sees = async (userId: string, ids: string[]) => (await visibleRequirementIdsFor(await viewerFor(userId), ids)).size;

const restrict = (userIds: string[] | null) =>
  prisma.$transaction((tx) =>
    setRestriction(tx, {
      documentId,
      mode: userIds ? 'EXPLICIT' : 'INHERIT',
      grants: (userIds ?? []).map((userId) => ({ userId, canView: true, canEdit: true })),
    }),
  );

beforeAll(async () => {
  const make = async (name: string) =>
    (await prisma.user.create({ data: { email: `xf-${name}-${tag}@test`, name, passwordHash: await hashPassword('x') } })).id;
  [owner, insider, outsider] = await Promise.all([make('owner'), make('insider'), make('outsider')]);
  spaceKey = `XF${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Rule X4' } })).id;
  await prisma.membership.createMany({
    data: [
      { spaceId, userId: owner, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
      { spaceId, userId: insider, permissions: ['VIEW'] },
      { spaceId, userId: outsider, permissions: ['VIEW'] },
    ],
  });

  documentId = (await createDocument({ spaceId, title: 'Sensitive', parentId: null, authorId: owner })).id;
  const content: PMNode = { type: 'doc', content: [para(text('The sensitive requirement. '), marker(KEY))] };
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId,
    content,
    authorId: owner,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, { spaceId, spaceKey, documentId, versionId: version.id, actorId: owner, result });
    },
  });

  // Frozen while restricted to the owner and the insider.
  await restrict([owner, insider]);
  baselineId = (
    await createDraft({
      spaceId,
      name: 'While restricted',
      sourceQuery: `key = '${KEY}'`,
      includedDependencies: false,
      includedExternal: false,
      createdById: owner,
    })
  ).id;
  registerJobHandlers();
  const job = await enqueueJob({
    spaceId,
    kind: 'freeze-baseline',
    actorId: owner,
    payload: { spaceKey, baselineId, memberKeys: [KEY], includedExternal: false, batchSize: 500, actorId: owner },
  });
  await runJobNow(job.id);
}, 180_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { spaceId } });
  await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
  await prisma.requirement.deleteMany({ where: { spaceId } });
  await prisma.baseline.deleteMany({ where: { spaceId } });
  await prisma.documentViewGate.deleteMany({ where: { documentId } });
  await prisma.documentRestriction.deleteMany({ where: { documentId } });
  await prisma.indexDiagnostic.deleteMany({ where: { documentId } });
  await prisma.documentVersion.updateMany({ where: { documentId }, data: { pinned: false } });
  await prisma.document.update({ where: { id: documentId }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { documentId } });
  await prisma.document.deleteMany({ where: { id: documentId } });
  await prisma.job.deleteMany({ where: { spaceId } });
  await prisma.membership.deleteMany({ where: { spaceId } });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, insider, outsider] } } });
  await prisma.$disconnect();
});

describe('rule X4 (RD-059)', () => {
  it('captured the restriction when the freeze completed', async () => {
    expect(await frozenIds()).toHaveLength(1);
    expect(await prisma.baselineViewGate.count({ where: { baselineId } })).toBe(1);
    expect(await prisma.baselineGateGrant.count({ where: { baselineId } })).toBe(2);
    expect(await sees(insider, await frozenIds())).toBe(1);
    expect(await sees(outsider, await frozenIds())).toBe(0);
  });

  it('loosening the document exposes the live text but never the baselined text', async () => {
    await restrict(null);
    expect(await sees(outsider, await liveIds())).toBe(1);
    expect(await sees(outsider, await frozenIds())).toBe(0);
    // The people the freeze admitted still see it.
    expect(await sees(insider, await frozenIds())).toBe(1);
  });

  it('tightening the document applies to the baseline at once', async () => {
    await restrict([owner]);
    expect(await sees(insider, await frozenIds())).toBe(0);
    expect(await sees(insider, await liveIds())).toBe(0);
    expect(await sees(owner, await frozenIds())).toBe(1);
  });
});
