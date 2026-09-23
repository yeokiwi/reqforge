import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { hashPassword } from '@/server/auth/password';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { resolveStoredPath } from '@/server/jobs/storage';
import { captureBaselineLabel } from '@/server/repositories/classification';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { enqueueJob, findJob } from '@/server/repositories/jobs';
import { applyIndexResult } from '@/server/repositories/requirements';
import { viewerFor } from '@/server/repositories/visibility';
import { effectiveDocumentLabel } from '@/server/usecases/classification';

/**
 * Classification labels on real output. spec: 07-permissions-and-limits.md §2.3 — labels
 * appear "on every exported file's header/footer, and in the xlsx export's first sheet";
 * "every export carries the label of the highest-classified content it contains"; a
 * document's label is "the highest of its own and any label on content it embeds";
 * baselines inherit it. RD-060.
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string): PMNode => ({ type: 'requirementLink', attrs: { key, spaceKey: null } });
const HIGH_KEY = `CEH${tag}-001`;
const LOW_KEY = `CEL${tag}-001`;

let spaceId = '';
let spaceKey = '';
let userId = '';
let lowId = '';
let highId = '';
let highDocument = '';
let plainDocument = '';
const levelIds: string[] = [];

async function save(documentId: string, content: PMNode) {
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, { spaceId, spaceKey, documentId, versionId: version.id, actorId: userId, result });
    },
  });
}

async function exportMatrix(query: string): Promise<ExcelJS.Workbook> {
  registerJobHandlers();
  const job = await enqueueJob({
    kind: 'export-matrix',
    spaceId,
    actorId: userId,
    payload: {
      spaceKey,
      spaceName: 'Labels',
      // The floor the job was queued with: the space's own label.
      classification: `Low ${tag}`,
      name: 'Labelled',
      config: { query, columns: [{ kind: 'key' }, { kind: 'title' }], pageSize: 50, treeView: false },
      rowsPerPage: 50,
    },
  });
  await runJobNow(job.id);
  const done = await findJob(job.id);
  expect(done?.state).toBe('DONE');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolveStoredPath(done!.resultRef!)!);
  return workbook;
}

beforeAll(async () => {
  // Ranks far from anything seeded or created by a parallel test.
  const base = 100_000 + Math.floor(Math.random() * 800_000);
  lowId = (await prisma.classificationLevel.create({ data: { name: `Low ${tag}`, rank: base } })).id;
  highId = (await prisma.classificationLevel.create({ data: { name: `High ${tag}`, rank: base + 1 } })).id;
  levelIds.push(lowId, highId);

  userId = (await prisma.user.create({ data: { email: `ce-${tag}@test`, name: 'Labeller', passwordHash: await hashPassword('x') } })).id;
  spaceKey = `CE${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Labels', classificationId: lowId } })).id;
  await prisma.membership.create({ data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] } });

  highDocument = (await createDocument({ spaceId, title: 'Highly classified', parentId: null, authorId: userId })).id;
  await prisma.document.update({ where: { id: highDocument }, data: { classificationId: highId } });
  await save(highDocument, { type: 'doc', content: [para(text('Sensitive. '), marker(HIGH_KEY))] });

  plainDocument = (await createDocument({ spaceId, title: 'Plain', parentId: null, authorId: userId })).id;
  await save(plainDocument, { type: 'doc', content: [para(text('Ordinary. '), marker(LOW_KEY))] });
}, 120_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { spaceId } });
  await prisma.job.deleteMany({ where: { spaceId } });
  await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
  await prisma.requirement.deleteMany({ where: { spaceId } });
  await prisma.baseline.deleteMany({ where: { spaceId } });
  await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
  await prisma.document.updateMany({ where: { spaceId }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
  await prisma.document.deleteMany({ where: { spaceId } });
  await prisma.membership.deleteMany({ where: { spaceId } });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.classificationLevel.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.$disconnect();
});

describe('export labels (spec 07 §2.3)', () => {
  it('carries the highest label of anything in the file, not the space`s', async () => {
    const workbook = await exportMatrix(`key ~ 'CE%${tag}-%'`);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe(`Classification: High ${tag}`);
    // …and on every sheet's header and footer, so one printed page still says it.
    for (const each of workbook.worksheets) {
      expect(each.headerFooter.oddHeader).toContain(`High ${tag}`);
      expect(each.headerFooter.oddFooter).toContain(`High ${tag}`);
    }
  });

  it('falls back to the space`s label when nothing in the file is higher', async () => {
    const workbook = await exportMatrix(`key = '${LOW_KEY}'`);
    expect(workbook.worksheets[0]!.getRow(1).getCell(1).value).toBe(`Classification: Low ${tag}`);
  });
});

describe('a document`s effective label (propagated upward)', () => {
  it('is its own and its space`s until it embeds something higher', async () => {
    const viewer = await viewerFor(userId);
    const space = { id: spaceId, key: spaceKey, isolated: false };
    const plain = { type: 'doc', content: [para(text('Nothing embedded.'))] };
    expect((await effectiveDocumentLabel({ viewer, space, documentId: plainDocument, content: plain }))?.name).toBe(`Low ${tag}`);

    const linking = { type: 'doc', content: [para(text('See '), link(HIGH_KEY))] };
    expect((await effectiveDocumentLabel({ viewer, space, documentId: plainDocument, content: linking }))?.name).toBe(`High ${tag}`);

    const reporting = { type: 'doc', content: [{ type: 'report', attrs: { id: 'r', query: `key = '${HIGH_KEY}'`, columns: '' } }] };
    expect((await effectiveDocumentLabel({ viewer, space, documentId: plainDocument, content: reporting }))?.name).toBe(`High ${tag}`);
  });
});

describe('a baseline`s label', () => {
  it('is the highest among its members, captured at freeze', async () => {
    const baseline = await prisma.baseline.create({
      data: { spaceId, number: 1, name: 'Labelled', state: 'FROZEN', sourceQuery: 'x', frozenAt: new Date() },
    });
    const source = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: HIGH_KEY, baselineId: null } });
    await prisma.requirement.create({
      data: {
        spaceId,
        baselineId: baseline.id,
        key: HIGH_KEY,
        upperKey: HIGH_KEY,
        uid: source.uid,
        title: source.title,
        bodyHtml: source.bodyHtml,
        bodySearch: source.bodySearch,
        anchorPath: source.anchorPath,
        originVersionId: source.originVersionId,
      },
    });
    await captureBaselineLabel(baseline.id);
    const captured = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id }, select: { classificationId: true } });
    expect(captured.classificationId).toBe(highId);
  });
});
