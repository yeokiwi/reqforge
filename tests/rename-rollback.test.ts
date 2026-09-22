import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';
import { renameRequirements, RenameWasCancelled } from '@/server/repositories/rename';

/**
 * **The acceptance of slice 15.** PLAN.md: "an induced failure mid-rename leaves zero
 * modifications" — Requirement Yogi's "No modification was saved" (research §2.8).
 *
 * spec: 03-authoring-and-indexing.md §5 — "one job, one database transaction, full
 * rollback on any error". The failure is induced from the progress hook, which the rename
 * calls after each document it rewrites: by then the keys have moved, aliases have been
 * written and at least one document has a new version, so a rollback that works here is
 * a rollback that works anywhere.
 */

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string): PMNode => ({ type: 'requirementLink', attrs: { key, spaceKey: null } });
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const K = (n: number) => `RB${tag}-00${n}`;

let spaceId = '';
let spaceKey = '';
let userId = '';
const documentIds: string[] = [];

async function save(documentId: string, content: PMNode) {
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
        historyEnabled: true,
      });
    },
  });
}

/** Everything a rename is allowed to touch, as one comparable value. */
async function snapshot(): Promise<string> {
  const [requirements, versions, aliases, history, audit, unresolved, searches] = await Promise.all([
    prisma.requirement.findMany({
      where: { spaceId },
      orderBy: { id: 'asc' },
      select: { id: true, key: true, upperKey: true, status: true, renamedFrom: true, baselineId: true },
    }),
    prisma.documentVersion.findMany({
      where: { document: { spaceId } },
      orderBy: [{ documentId: 'asc' }, { number: 'asc' }],
      select: { documentId: true, number: true, content: true, message: true },
    }),
    prisma.requirementKeyAlias.findMany({ where: { spaceId }, orderBy: { upperKey: 'asc' }, select: { upperKey: true, requirementId: true } }),
    prisma.requirementHistory.findMany({ where: { spaceId }, orderBy: { id: 'asc' }, select: { changeKind: true, before: true, after: true } }),
    prisma.auditEvent.findMany({ where: { spaceId }, orderBy: { id: 'asc' }, select: { operation: true, parameters: true } }),
    prisma.unresolvedDependency.findMany({ where: { child: { spaceId } }, orderBy: { id: 'asc' }, select: { targetKey: true, relationship: true } }),
    prisma.savedSearch.findMany({ where: { spaceId }, orderBy: { name: 'asc' }, select: { name: true, query: true } }),
  ]);
  return JSON.stringify({ requirements, versions, aliases, history, audit, unresolved, searches });
}

describe('a failed rename saves nothing (spec 03 §5)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `rb-${tag}@test`, name: 'Roller', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `RB${tag}`.slice(0, 10);
    spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Rollback', historyEnabled: true } })).id;

    // Three documents, so the failure lands after one of them has already been rewritten.
    const definitions = await createDocument({ spaceId, title: 'Definitions', parentId: null, authorId: userId });
    documentIds.push(definitions.id);
    await save(
      definitions.id,
      doc(
        table(
          row(th(para(text('Key'))), th(para(text('Title')))),
          ...[1, 2, 3].map((n) => row(td(para(marker(K(n)))), td(para(text(`Title ${n}`))))),
        ),
      ),
    );

    for (const n of [1, 2]) {
      const references = await createDocument({ spaceId, title: `References ${n}`, parentId: null, authorId: userId });
      documentIds.push(references.id);
      await save(references.id, doc(para(text('See '), link(K(1)), text(' and '), link(K(2)), text(' and '), link(K(3)))));
    }

    await prisma.savedSearch.create({
      data: { spaceId, name: `saved-${tag}`, query: `key = '${K(1)}'`, ownerId: userId },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { spaceId } });
    await prisma.requirementHistory.deleteMany({ where: { spaceId } });
    await prisma.requirementKeyAlias.deleteMany({ where: { spaceId } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.unresolvedDependency.deleteMany({ where: { child: { spaceId } } });
    await prisma.dependency.deleteMany({ where: { child: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.savedSearch.deleteMany({ where: { spaceId } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentVersion.updateMany({ where: { document: { spaceId } }, data: { pinned: false } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('leaves zero modifications when the rename fails part of the way through', async () => {
    const before = await snapshot();

    let documentsRewritten = 0;
    const failure = renameRequirements(
      {
        spaceId,
        spaceKey,
        actorId: userId,
        jobId: 'job-rollback',
        historyEnabled: true,
        pairs: [1, 2, 3].map((n) => ({ from: K(n), to: `${spaceKey}X-00${n}` })),
      },
      {
        progress: async (_percent, message) => {
          if (!message.includes('documents rewritten')) return;
          documentsRewritten += 1;
          if (documentsRewritten === 2) throw new Error('induced failure');
        },
      },
    );

    await expect(failure).rejects.toThrow('induced failure');
    // The failure really did land after work had been done, or this proves nothing.
    expect(documentsRewritten).toBe(2);

    expect(await snapshot()).toBe(before);
  });

  it('gives a cancelled rename the same guarantee as a failed one', async () => {
    // spec 03 §5 — "job progress with cancel". Cancelling unwinds the same transaction, so
    // "no modification was saved" is true of a stop as well as of an error.
    const before = await snapshot();

    let seen = 0;
    const cancelled = renameRequirements(
      {
        spaceId,
        spaceKey,
        actorId: userId,
        jobId: 'job-cancel',
        historyEnabled: true,
        pairs: [1, 2, 3].map((n) => ({ from: K(n), to: `${spaceKey}C-00${n}` })),
      },
      {
        cancelled: async () => {
          seen += 1;
          // Not the first check: the keys and the aliases have already moved by then.
          return seen > 2;
        },
      },
    );

    await expect(cancelled).rejects.toBeInstanceOf(RenameWasCancelled);
    expect(await snapshot()).toBe(before);
  });

  it('still renames cleanly once the failure is gone, so the rollback left no debris', async () => {
    const summary = await renameRequirements({
      spaceId,
      spaceKey,
      actorId: userId,
      jobId: 'job-clean',
      historyEnabled: true,
      pairs: [1, 2, 3].map((n) => ({ from: K(n), to: `${spaceKey}X-00${n}` })),
    });

    expect(summary.renamed).toBe(3);
    expect(summary.documentsRewritten).toBe(3);

    const keys = await prisma.requirement.findMany({
      where: { spaceId, baselineId: null },
      orderBy: { key: 'asc' },
      select: { key: true },
    });
    expect(keys.map((entry) => entry.key)).toEqual([1, 2, 3].map((n) => `${spaceKey}X-00${n}`));
  });
});
