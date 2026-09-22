import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffSides, DEFAULT_COMPARE, DEFAULT_IGNORE } from '@/domain/diff';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { parse } from '@/domain/ryql';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { createDraft } from '@/server/repositories/baselines';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { enqueueJob } from '@/server/repositories/jobs';
import { aliasMapFor, renameRequirements, resolveKeyAlias } from '@/server/repositories/rename';
import { applyIndexResult } from '@/server/repositories/requirements';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';

/**
 * **The other half of slice 15's acceptance.** PLAN.md: "a baselined requirement keeps its
 * original key and still resolves from the renamed live one."
 *
 * spec: 03-authoring-and-indexing.md §5; `RD-007` — invariant R2 (frozen rows are
 * immutable) outranks naming consistency, so the snapshot keeps its key and the alias
 * chain is what makes history and diff resolve across the rename (`RD-051`).
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
const K = (n: number) => `BR${tag}-00${n}`;
const NEW = (n: number) => `SYS${tag}-00${n}`;

let spaceId = '';
let spaceKey = '';
let userId = '';
let documentId = '';
let baselineId = '';

const content = (titles: Record<number, string>): PMNode =>
  doc(
    table(
      row(th(para(text('Key'))), th(para(text('Title')))),
      ...[1, 2].map((n) => row(td(para(marker(K(n)))), td(para(text(titles[n] ?? `Title ${n}`))))),
    ),
  );

async function save(node: PMNode) {
  const result = indexDocumentVersion({ content: node, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId,
    content: node,
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

/** The live rows the diff compares, in the shape `diffSides` takes. */
async function comparable(where: { baselineId: string | null }) {
  const rows = await prisma.requirement.findMany({
    where: { spaceId, baselineId: where.baselineId, status: { not: 'DELETED' } },
    orderBy: { key: 'asc' },
    select: { key: true, title: true, bodySearch: true },
  });
  return rows.map((entry) => ({
    key: entry.key,
    title: entry.title,
    bodyHtml: entry.bodySearch,
    bodySearch: entry.bodySearch,
    inlineProperties: [],
    externalProperties: [],
    dependencies: [],
  }));
}

describe('renaming across a baseline (RD-007)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `br-${tag}@test`, name: 'Baseliner', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `BR${tag}`.slice(0, 10);
    spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Baselined rename', historyEnabled: true } })).id;
    // The freeze job re-checks ADMIN at run time (spec 05 §3.2), so the actor needs it.
    await prisma.membership.create({
      data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
    });
    documentId = (await createDocument({ spaceId, title: 'Definitions', parentId: null, authorId: userId })).id;

    await save(content({}));

    const baseline = await createDraft({
      spaceId,
      name: `Before the rename ${tag}`,
      sourceQuery: `key ~ 'BR${tag}-%'`,
      includedDependencies: false,
      includedExternal: false,
      createdById: userId,
    });
    baselineId = baseline.id;

    registerJobHandlers();
    const job = await enqueueJob({
      spaceId,
      kind: 'freeze-baseline',
      actorId: userId,
      payload: {
        spaceKey,
        baselineId,
        memberKeys: [K(1), K(2)],
        includedExternal: false,
        batchSize: 500,
        actorId: userId,
      },
    });
    await runJobNow(job.id);
  }, 180_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { spaceId } });
    await prisma.requirementHistory.deleteMany({ where: { spaceId } });
    await prisma.requirementKeyAlias.deleteMany({ where: { spaceId } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.dependency.deleteMany({ where: { child: { spaceId } } });
    await prisma.unresolvedDependency.deleteMany({ where: { child: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.baselineRevision.deleteMany({ where: { baseline: { spaceId } } });
    await prisma.baseline.deleteMany({ where: { spaceId } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentVersion.updateMany({ where: { document: { spaceId } }, data: { pinned: false } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.membership.deleteMany({ where: { spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('froze both requirements under their original keys', async () => {
    const frozen = await prisma.requirement.findMany({
      where: { spaceId, baselineId },
      orderBy: { key: 'asc' },
      select: { key: true },
    });
    expect(frozen.map((entry) => entry.key)).toEqual([K(1), K(2)]);
  });

  it('renames only the live rows, and leaves the snapshot exactly as it was frozen', async () => {
    // The title also moves, so the renamed requirement is genuinely modified as well.
    await save(content({ 1: 'Changed title' }));
    await renameRequirements({
      spaceId,
      spaceKey,
      actorId: userId,
      pairs: [1, 2].map((n) => ({ from: K(n), to: NEW(n) })),
      historyEnabled: true,
    });

    const frozen = await prisma.requirement.findMany({
      where: { spaceId, baselineId },
      orderBy: { key: 'asc' },
      select: { key: true, renamedFrom: true },
    });
    expect(frozen.map((entry) => entry.key)).toEqual([K(1), K(2)]);
    expect(frozen.every((entry) => entry.renamedFrom === null)).toBe(true);

    const live = await prisma.requirement.findMany({
      where: { spaceId, baselineId: null },
      orderBy: { key: 'asc' },
      select: { key: true },
    });
    expect(live.map((entry) => entry.key)).toEqual([NEW(1), NEW(2)]);
  });

  it('resolves the frozen key back to the renamed live requirement', async () => {
    const resolved = await resolveKeyAlias(spaceId, K(1));
    expect(resolved?.currentKey).toBe(NEW(1));
  });

  it('pairs the two sides of a diff through the chain, rather than calling it added and removed', async () => {
    const [before, after] = await Promise.all([comparable({ baselineId }), comparable({ baselineId: null })]);
    const aliases = await aliasMapFor(spaceId, [...before, ...after].map((entry) => entry.key));

    const outcome = diffSides(
      before,
      after,
      DEFAULT_COMPARE,
      DEFAULT_IGNORE,
      ['added', 'removed', 'modified', 'unchanged'],
      600,
      aliases,
    );

    expect(outcome.summary).toEqual({ added: 0, removed: 0, modified: 1, unchanged: 1 });
    expect(outcome.rows.find((entry) => entry.kind === 'modified')?.key).toBe(NEW(1));
  });

  it('finds the same requirement with isModified, which is the agreement RD-047 requires', async () => {
    const number = (await prisma.baseline.findUniqueOrThrow({
      where: { id: baselineId },
      select: { number: true },
    })).number;

    const ids = await runSearchIds(parse(`key ~ 'SYS${tag}-%' AND isModified(${number})`), {
      visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
    });

    const rows = await prisma.requirement.findMany({
      where: { id: { in: ids } },
      select: { key: true },
    });
    expect(rows.map((entry) => entry.key)).toEqual([NEW(1)]);
  });

  it('still reports a snapshot exists for the renamed requirement (baseline was N)', async () => {
    const number = (await prisma.baseline.findUniqueOrThrow({
      where: { id: baselineId },
      select: { number: true },
    })).number;

    const ids = await runSearchIds(parse(`key ~ 'SYS${tag}-%' AND baseline was ${number}`), {
      visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
    });
    expect(ids).toHaveLength(2);
  });
});
