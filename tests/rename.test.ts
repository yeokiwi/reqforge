import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';
import { formerKeys, renameRequirements, resolveKeyAlias } from '@/server/repositories/rename';
import { SYSTEM } from '@/server/repositories/visibility';

/**
 * Renaming: propagation, the alias chain, and what it refuses.
 * spec: 03-authoring-and-indexing.md §5. RD-050, RD-051, RD-052, RD-054.
 */

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string, attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'requirementLink',
  attrs: { key, spaceKey: null, ...attrs },
});
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const K = (n: number) => `RN${tag}-00${n}`;

let spaceId = '';
let spaceKey = '';
let userId = '';
let mainDoc = '';
let otherDoc = '';

async function save(documentId: string, content: PMNode, historyEnabled = true) {
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
        historyEnabled,
      });
    },
  });
}

/** Three requirements, the third depending on the first. */
const definitions = (...keys: string[]): PMNode =>
  doc(
    table(
      row(th(para(text('Key'))), th(para(text('Title'))), th(para(text('Category')))),
      ...keys.map((key) => row(td(para(marker(key))), td(para(text(`Title of ${key}`))), td(para(text('Safety'))))),
    ),
  );

/** A second document that only links at them. */
const references = (...keys: string[]): PMNode =>
  doc(para(text('See '), ...keys.map((key) => link(key))));

const currentContent = async (documentId: string): Promise<string> => {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { currentVersionId: true },
  });
  const version = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: document.currentVersionId! },
    select: { content: true },
  });
  return JSON.stringify(version.content);
};

const liveKeys = async (): Promise<string[]> => {
  const rows = await prisma.requirement.findMany({
    where: { spaceId, baselineId: null, status: { not: 'DELETED' } },
    orderBy: { key: 'asc' },
    select: { key: true },
  });
  return rows.map((entry) => entry.key);
};

const rename = (pairs: Array<{ from: string; to: string }>, jobId = 'job-test') =>
  renameRequirements({ spaceId, spaceKey, actorId: userId, jobId, pairs, historyEnabled: true });

describe('renaming (spec 03 §5)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `rn-${tag}@test`, name: 'Renamer', passwordHash: await hashPassword('x') },
    });
    userId = user.id;

    spaceKey = `RN${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Rename', historyEnabled: true } });
    spaceId = space.id;

    mainDoc = (await createDocument({ spaceId, title: 'Definitions', parentId: null, authorId: userId })).id;
    otherDoc = (await createDocument({ spaceId, title: 'References', parentId: null, authorId: userId })).id;
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
    await prisma.savedMatrix.deleteMany({ where: { spaceId } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentVersion.updateMany({ where: { document: { spaceId } }, data: { pinned: false } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    await save(mainDoc, definitions(K(1), K(2), K(3)));
    await save(otherDoc, references(K(1), K(3)));
  }, 120_000);

  it('renames the row and keeps its identity', async () => {
    const before = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, upperKey: K(1).toUpperCase() },
      select: { id: true, uid: true },
    });

    const summary = await rename([{ from: K(1), to: `${spaceKey}X-1` }]);
    expect(summary.renamed).toBe(1);

    const after = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, upperKey: `${spaceKey}X-1`.toUpperCase() },
      select: { id: true, uid: true, renamedFrom: true },
    });
    // The row is the same row: its id and its marker uid survive (spec 03 §1.1).
    expect(after.id).toBe(before.id);
    expect(after.uid).toBe(before.uid);
    expect(after.renamedFrom).toBe(K(1));
  });

  it('rewrites the defining document and the one that only links at it (RD-050)', async () => {
    expect(await currentContent(mainDoc)).toContain(`${spaceKey}X-1`);
    expect(await currentContent(mainDoc)).not.toContain(`"${K(1)}"`);
    expect(await currentContent(otherDoc)).toContain(`${spaceKey}X-1`);
    expect(await currentContent(otherDoc)).not.toContain(`"${K(1)}"`);
  });

  it('leaves the reindex agreeing with the document, rather than resurrecting the old key', async () => {
    // The real hazard: applyIndexResult reconciles by key, so a document still saying the
    // old key would recreate it and mark the renamed row DELETED on the next save.
    await save(mainDoc, definitions(`${spaceKey}X-1`, K(2), K(3)));
    expect(await liveKeys()).toEqual([`${spaceKey}X-1`, K(2), K(3)].sort());
  });

  it('records the former key so an old reference still resolves (RD-051)', async () => {
    const resolved = await resolveKeyAlias(spaceId, K(1), SYSTEM);
    expect(resolved?.currentKey).toBe(`${spaceKey}X-1`);
    expect(resolved?.formerKey).toBe(K(1));
  });

  it('keeps every hop of the chain resolving after a second rename', async () => {
    await rename([{ from: `${spaceKey}X-1`, to: `${spaceKey}Y-1` }]);

    const first = await resolveKeyAlias(spaceId, K(1), SYSTEM);
    const second = await resolveKeyAlias(spaceId, `${spaceKey}X-1`, SYSTEM);
    expect(first?.currentKey).toBe(`${spaceKey}Y-1`);
    expect(second?.currentKey).toBe(`${spaceKey}Y-1`);

    const row = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, upperKey: `${spaceKey}Y-1`.toUpperCase() },
      select: { id: true },
    });
    expect(await formerKeys(row.id)).toEqual([`${spaceKey}X-1`, K(1)]);
  });

  it('swaps two keys in one batch, which a single-pass update could not do', async () => {
    await rename([
      { from: K(2), to: K(3) },
      { from: K(3), to: K(2) },
    ]);

    const two = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, upperKey: K(2).toUpperCase() },
      select: { uid: true },
    });
    // The requirement now called ...-002 is the one that used to be ...-003.
    expect(two.uid).toBe(`uid-${K(3)}`);
    expect(await currentContent(mainDoc)).toContain(K(2));
    expect(await currentContent(mainDoc)).toContain(K(3));
  });

  it('writes one KEY_RENAMED row per requirement, with the actor', async () => {
    const rows = await prisma.requirementHistory.findMany({
      where: { spaceId, changeKind: 'KEY_RENAMED' },
      orderBy: { at: 'asc' },
      select: { actorId: true, before: true, after: true },
    });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((entry) => entry.actorId === userId)).toBe(true);
    expect(rows[0]?.before).toEqual({ key: K(1) });
    expect(rows[0]?.after).toEqual({ key: `${spaceKey}X-1` });
  });

  it('writes an audit row carrying the whole mapping (spec 07 §6)', async () => {
    const events = await prisma.auditEvent.findMany({
      where: { spaceId, operation: 'rename' },
      orderBy: { at: 'asc' },
      select: { objectType: true, actorId: true, parameters: true },
    });
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]?.objectType).toBe('Requirement');
    expect(events[0]?.actorId).toBe(userId);
    // Reconstructable from the log alone: the pairs are there, not a count.
    expect(JSON.stringify(events[0]?.parameters)).toContain(K(1));
  });

  it('rewrites a saved search and a saved matrix that name the key (RD-052)', async () => {
    const search = await prisma.savedSearch.create({
      data: { spaceId, name: `s-${tag}`, query: `key = '${K(2)}' AND @Category = '${K(2)}'`, ownerId: userId },
    });
    const matrix = await prisma.savedMatrix.create({
      data: {
        spaceId,
        name: `m-${tag}`,
        kind: 'TRACEABILITY',
        query: `key ~ '${K(2)}'`,
        columns: [],
        ownerId: userId,
      },
    });

    const summary = await rename([{ from: K(2), to: `${spaceKey}Z-2` }]);
    expect(summary.queriesRewritten).toBe(1);

    const savedSearch = await prisma.savedSearch.findUniqueOrThrow({ where: { id: search.id } });
    // The key literal moved; the property value that merely looks like a key did not.
    expect(savedSearch.query).toBe(`key = '${spaceKey}Z-2' AND @Category = '${K(2)}'`);

    // A LIKE pattern is a question, not a reference.
    const savedMatrix = await prisma.savedMatrix.findUniqueOrThrow({ where: { id: matrix.id } });
    expect(savedMatrix.query).toBe(`key ~ '${K(2)}'`);
  });

  it('refuses a key another live requirement already has', async () => {
    await expect(rename([{ from: K(3), to: `${spaceKey}Y-1` }])).rejects.toThrow(/not available/i);
  });

  it('refuses a key that is still another requirement`s former key (RD-051)', async () => {
    // K(1) is the former key of ...Y-1; handing it to a different requirement would make
    // every link written before that rename point at the wrong thing.
    await expect(rename([{ from: K(3), to: K(1) }])).rejects.toThrow(/not available/i);
  });

  it('refuses a key that is not a live requirement of this space', async () => {
    await expect(rename([{ from: 'NOPE-999', to: `${spaceKey}Q-9` }])).rejects.toThrow(/not a live requirement/i);
  });

  it('refuses a batch beyond the limit (RD-054)', async () => {
    const pairs = Array.from({ length: 2_001 }, (_, index) => ({ from: `A-${index}`, to: `B-${index}` }));
    // spec 07 §4 — the named limit error (RD-071).
    await expect(rename(pairs)).rejects.toThrow(/"Requirements per rename" limit exceeded: .*the limit is 2,000/);
  });
});
