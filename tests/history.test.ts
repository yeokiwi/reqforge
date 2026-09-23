import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { changesBetween, listHistory, pruneHistory, type RequirementSnapshot } from '@/server/repositories/history';
import { applyIndexResult } from '@/server/repositories/requirements';
import { viewerFor } from '@/server/repositories/visibility';

/**
 * The per-requirement change log.
 * spec: 05-baselines-and-diff.md §6; RD-014 (authorship is exact), RD-048 (which kinds
 * this slice writes), RD-049 (what retention protects).
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
let otherId = '';
let documentId = '';

const key = `HI${tag}-001`;

const one = (title: string, status: string): PMNode =>
  doc(
    table(
      row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('Key')))),
      row(td(para(text(title))), td(para(text(status))), td(para(marker(key)))),
    ),
  );

async function save(content: PMNode, actorId = userId, historyEnabled = true) {
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId,
    content,
    authorId: actorId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, {
        spaceId,
        spaceKey,
        documentId,
        versionId: version.id,
        actorId,
        result,
        historyEnabled,
      });
    },
  });
}

const kindsFor = async (requirementKey = key) => {
  const rows = await prisma.requirementHistory.findMany({
    where: { spaceId, requirement: { upperKey: requirementKey.toUpperCase() } },
    orderBy: { at: 'asc' },
    select: { changeKind: true, actorId: true },
  });
  return rows;
};

describe('changesBetween — one row per changed field', () => {
  const base: RequirementSnapshot = {
    title: 'A',
    bodySearch: 'A body',
    typeId: null,
    status: 'ACTIVE',
    properties: ['status=Draft'],
    dependencies: [],
  };

  it('a new requirement is CREATED and nothing else', () => {
    expect(changesBetween(null, base).map((change) => change.changeKind)).toEqual(['CREATED']);
  });

  it('an unchanged requirement produces no rows at all', () => {
    expect(changesBetween(base, { ...base })).toEqual([]);
  });

  it('names each field that moved, and only those', () => {
    const after = { ...base, title: 'B', properties: ['status=Approved'] };
    expect(changesBetween(base, after).map((change) => change.changeKind)).toEqual(['TITLE', 'PROPERTY']);
  });

  it('carries the before and the after, which is what an auditor reads', () => {
    const [change] = changesBetween(base, { ...base, title: 'B' });
    expect(change?.before).toEqual({ title: 'A' });
    expect(change?.after).toEqual({ title: 'B' });
  });

  it('records a status change, which is how contract I3 shows up in history', () => {
    expect(changesBetween(base, { ...base, status: 'DELETED' }).map((c) => c.changeKind)).toEqual(['STATUS']);
  });
});

describe('history on save (spec 05 §6)', () => {
  beforeAll(async () => {
    const [user, other] = await Promise.all([
      prisma.user.create({
        data: { email: `hi-${tag}@test`, name: 'Historian', passwordHash: await hashPassword('x') },
      }),
      prisma.user.create({
        data: { email: `hio-${tag}@test`, name: 'Other', passwordHash: await hashPassword('x') },
      }),
    ]);
    userId = user.id;
    otherId = other.id;

    spaceKey = `HI${tag}`.slice(0, 10);
    const space = await prisma.space.create({
      data: { key: spaceKey, name: 'History', historyEnabled: true },
    });
    spaceId = space.id;
    // The change log is requirement content (rule X3): its reader needs VIEW.
    await prisma.membership.create({ data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'ADMIN'] } });

    const document = await createDocument({ spaceId, title: 'Tracked', parentId: null, authorId: userId });
    documentId = document.id;
  }, 120_000);

  afterAll(async () => {
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
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it('records CREATED on the save that first writes the requirement', async () => {
    await save(one('First title', 'Draft'));
    expect((await kindsFor()).map((entry) => entry.changeKind)).toEqual(['CREATED']);
  });

  it('records nothing for a save that changed nothing', async () => {
    await save(one('First title', 'Draft'));
    expect((await kindsFor()).map((entry) => entry.changeKind)).toEqual(['CREATED']);
  });

  it('records the fields that moved, with the editing actor (RD-014)', async () => {
    await save(one('Second title', 'Draft'), otherId);

    const rows = await kindsFor();
    // In a horizontal table the title cell *is* the requirement's text (spec 03 §3.1),
    // so retitling moves both the title and `bodySearch`. Two fields, two rows.
    expect(rows.map((entry) => entry.changeKind)).toEqual(['CREATED', 'TITLE', 'BODY']);

    // Authorship is exact: each row carries whoever made *that* change.
    expect(rows[0]?.actorId).toBe(userId);
    expect(rows[1]?.actorId).toBe(otherId);
    expect(rows[2]?.actorId).toBe(otherId);
  });

  it('records a property change separately from the title and body', async () => {
    await save(one('Third title', 'Approved'));
    const kinds = (await kindsFor()).map((entry) => entry.changeKind);
    expect(kinds.slice(-3).sort()).toEqual(['BODY', 'PROPERTY', 'TITLE']);
  });

  it('writes nothing when the space has history off', async () => {
    const quiet = await prisma.space.create({ data: { key: `HQ${tag}`.slice(0, 10), name: 'Quiet' } });
    const document = await createDocument({
      spaceId: quiet.id,
      title: 'Untracked',
      parentId: null,
      authorId: userId,
    });

    const content = doc(para(marker(`HQ${tag}-1`), text(' Not recorded.')));
    const result = indexDocumentVersion({ content, space: { key: quiet.key } });
    await saveDocumentVersion({
      documentId: document.id,
      content,
      authorId: userId,
      onVersion: async (tx, version) => {
        await applyIndexResult(tx, {
          spaceId: quiet.id,
          spaceKey: quiet.key,
          documentId: document.id,
          versionId: version.id,
          actorId: userId,
          result,
          historyEnabled: quiet.historyEnabled,
        });
      },
    });

    expect(await prisma.requirementHistory.count({ where: { spaceId: quiet.id } })).toBe(0);

    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId: quiet.id } } });
    await prisma.requirement.deleteMany({ where: { spaceId: quiet.id } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId: quiet.id } } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId: quiet.id } } });
    await prisma.document.deleteMany({ where: { spaceId: quiet.id } });
    await prisma.space.delete({ where: { id: quiet.id } });
  });

  it('is searchable by actor, by kind and by date (spec 05 §6)', async () => {
    const byActor = await listHistory({ viewer: await viewerFor(userId), spaceId, actorId: otherId });
    expect(byActor.length).toBeGreaterThan(0);
    expect(byActor.every((entry) => entry.actorId === otherId)).toBe(true);

    const byKind = await listHistory({ viewer: await viewerFor(userId), spaceId, changeKind: 'TITLE' });
    expect(byKind.every((entry) => entry.changeKind === 'TITLE')).toBe(true);

    const future = await listHistory({ viewer: await viewerFor(userId), spaceId, since: new Date(Date.now() + 60_000) });
    expect(future).toEqual([]);

    // The requirement's key comes back with the row, so the screen needs no second query.
    expect(byKind[0]?.requirement.key).toBe(key);
  });
});

describe('retention (RD-049)', () => {
  it('prunes an old row but keeps one dated before a freeze that contains it', async () => {
    const localTag = `${tag}R`;
    const user = await prisma.user.create({
      data: { email: `hr-${localTag}@test`, name: 'Pruner', passwordHash: await hashPassword('x') },
    });
    const space = await prisma.space.create({
      data: { key: `HR${localTag}`.slice(0, 10), name: 'Retention', historyEnabled: true, historyRetentionDays: 30 },
    });

    const document = await createDocument({
      spaceId: space.id,
      title: 'Aged',
      parentId: null,
      authorId: user.id,
    });
    const content = doc(para(marker(`HR${localTag}-1`), text(' Aged requirement.')));
    const result = indexDocumentVersion({ content, space: { key: space.key } });
    await saveDocumentVersion({
      documentId: document.id,
      content,
      authorId: user.id,
      onVersion: async (tx, version) => {
        await applyIndexResult(tx, {
          spaceId: space.id,
          spaceKey: space.key,
          documentId: document.id,
          versionId: version.id,
          actorId: user.id,
          result,
          historyEnabled: true,
        });
      },
    });

    const live = await prisma.requirement.findFirstOrThrow({ where: { spaceId: space.id, baselineId: null } });

    // A frozen baseline holding it, frozen a year ago.
    const frozenAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const baseline = await prisma.baseline.create({
      data: {
        spaceId: space.id,
        number: 1,
        name: 'Old freeze',
        state: 'FROZEN',
        sourceQuery: 'x',
        frozenAt,
        frozenById: user.id,
      },
    });
    await prisma.requirement.create({
      data: {
        spaceId: space.id,
        baselineId: baseline.id,
        key: live.key,
        upperKey: live.upperKey,
        uid: `${live.uid}-frozen`,
        status: 'ARCHIVED',
        title: live.title,
        bodyHtml: live.bodyHtml,
        bodySearch: live.bodySearch,
        anchorPath: live.anchorPath,
      },
    });

    // Two old rows, one on each side of the freeze. Both are older than retention.
    const before = new Date(frozenAt.getTime() - 24 * 60 * 60 * 1000);
    const after = new Date(frozenAt.getTime() + 24 * 60 * 60 * 1000);
    await prisma.requirementHistory.createMany({
      data: [
        { requirementId: live.id, spaceId: space.id, actorId: user.id, changeKind: 'TITLE', at: before },
        { requirementId: live.id, spaceId: space.id, actorId: user.id, changeKind: 'BODY', at: after },
      ],
    });

    const outcome = await pruneHistory(space.id, 30);

    // The row that explains how the frozen text came to be is protected; the churn
    // after the freeze ages out.
    expect(outcome.protectedByBaseline).toBe(1);
    const left = await prisma.requirementHistory.findMany({
      where: { spaceId: space.id },
      select: { changeKind: true },
    });
    expect(left.map((entry) => entry.changeKind)).toContain('TITLE');
    expect(left.map((entry) => entry.changeKind)).not.toContain('BODY');
    expect(outcome.removed).toBeGreaterThan(0);

    await prisma.requirementHistory.deleteMany({ where: { spaceId: space.id } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId: space.id } } });
    await prisma.requirement.deleteMany({ where: { spaceId: space.id } });
    await prisma.baseline.deleteMany({ where: { spaceId: space.id } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId: space.id } } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId: space.id } } });
    await prisma.document.deleteMany({ where: { spaceId: space.id } });
    await prisma.space.delete({ where: { id: space.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }, 120_000);
});
