import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { columnId, groupRowsByDocument, type MatrixColumn } from '@/domain/traceability/matrix';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { resolveStoredPath } from '@/server/jobs/storage';
import { prisma } from '@/server/repositories/client';
import { enqueueJob, findJob } from '@/server/repositories/jobs';
import { runMatrixForUser } from '@/server/usecases/matrix';
import {
  categoryOf,
  createCorpusSpace,
  dropCorpusSpace,
  isDeleted,
  keyOf,
  TOTAL,
  type FixtureHandles,
} from './fixtures/corpus-space';

let fixture: FixtureHandles;

const run = async (options: {
  columns: MatrixColumn[];
  query?: string;
  pageSize?: number;
  offset?: number;
  as?: 'user' | 'stranger';
  documentId?: string | null;
}) => {
  const result = await runMatrixForUser({
    space: { id: fixture.spaceId, key: fixture.spaceKey, isolated: false },
    userId: options.as === 'stranger' ? fixture.strangerId : fixture.userId,
    config: {
      query: options.query ?? "key ~ '%'",
      columns: options.columns,
      pageSize: options.pageSize ?? 100,
      treeView: false,
    },
    offset: options.offset ?? 0,
    documentId: options.documentId ?? null,
  });

  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.page;
};

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
  registerJobHandlers();
}, 120_000);

afterAll(async () => {
  await prisma.job.deleteMany({ where: { spaceId: fixture.spaceId } });
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('matrix rows and columns (spec 04 §2)', () => {
  it('one row per requirement, driven by the query, with the total for paging', async () => {
    const page = await run({ columns: [{ kind: 'key' }, { kind: 'title' }, { kind: 'status' }] });

    const active = Array.from({ length: TOTAL }, (_, index) => index).filter((index) => !isDeleted(index));
    expect(page.total).toBe(active.length);
    expect(page.rows).toHaveLength(100);
    expect(page.rows[0]!.cells[columnId({ kind: 'key' })]?.text).toBe(page.rows[0]!.key);
    expect(page.rows[0]!.cells[columnId({ kind: 'status' })]?.text).toBe('ACTIVE');
  });

  it('pages without changing the total', async () => {
    const first = await run({ columns: [{ kind: 'key' }], pageSize: 25 });
    const second = await run({ columns: [{ kind: 'key' }], pageSize: 25, offset: 25 });

    expect(first.total).toBe(second.total);
    expect(first.rows.map((row) => row.key)).not.toEqual(second.rows.map((row) => row.key));
    expect(new Set([...first.rows, ...second.rows].map((row) => row.key)).size).toBe(50);
  });

  it('renders property, external and document columns from batched fetches', async () => {
    const columns: MatrixColumn[] = [
      { kind: 'key' },
      { kind: 'property', name: 'Category' },
      { kind: 'external', name: 'Approval', editable: false },
      { kind: 'document' },
    ];
    const page = await run({ columns, query: `key = '${keyOf(0)}'` });
    const row = page.rows[0]!;

    expect(row.cells[columnId({ kind: 'property', name: 'Category' })]?.text).toBe(categoryOf(0));
    expect(row.cells[columnId({ kind: 'external', name: 'Approval', editable: false })]?.text).toBe('Signed off');
    expect(row.cells[columnId({ kind: 'document' })]?.text).toBe('Functional specification');
    expect(row.documentTitle).toBe('Functional specification');
  });

  it('renders a list-valued property as every member (RD-027)', async () => {
    const column: MatrixColumn = { kind: 'property', name: 'Tags' };
    const page = await run({ columns: [{ kind: 'key' }, column], query: `key = '${keyOf(0)}'` });
    expect(page.rows[0]!.cells[columnId(column)]?.text).toBe('safety, audit');
  });

  it('renders dependency columns in both directions, with counts and titles', async () => {
    const outbound: MatrixColumn = { kind: 'dependency', direction: 'to', depth: 1, render: 'key' };
    const count: MatrixColumn = { kind: 'dependency', direction: 'to', depth: 1, render: 'count' };
    const inbound: MatrixColumn = { kind: 'dependency', direction: 'from', depth: 1, render: 'key+title' };

    // FN-001 refines BR-001 (invariant P1: FN is the child, BR the parent).
    const child = await run({ columns: [{ kind: 'key' }, outbound, count], query: "key = 'FN-001'" });
    expect(child.rows[0]!.cells[columnId(outbound)]?.text).toBe('BR-001');
    expect(child.rows[0]!.cells[columnId(count)]).toMatchObject({ text: '1', count: 1 });

    const parent = await run({ columns: [{ kind: 'key' }, inbound], query: "key = 'BR-001'" });
    expect(parent.rows[0]!.cells[columnId(inbound)]?.text).toContain('FN-001 — Requirement FN-001');
  });

  it('a transitive dependency column follows the chain and stops at the depth cap', async () => {
    const depth2: MatrixColumn = { kind: 'dependency', direction: 'from', depth: 2, render: 'key' };
    const page = await run({ columns: [{ kind: 'key' }, depth2], query: "key = 'BR-001'" });

    // BR-001 has children (FN-001, FN-151…) and those have none, so depth 2 adds nothing
    // beyond depth 1 — but it must not loop or duplicate.
    const keys = page.rows[0]!.cells[columnId(depth2)]?.keys ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a relationship filter narrows the column', async () => {
    const wrong: MatrixColumn = { kind: 'dependency', direction: 'to', relationship: 'verifies', depth: 1, render: 'key' };
    const right: MatrixColumn = { kind: 'dependency', direction: 'to', relationship: 'refines', depth: 1, render: 'key' };

    const page = await run({ columns: [{ kind: 'key' }, wrong, right], query: "key = 'FN-001'" });
    expect(page.rows[0]!.cells[columnId(wrong)]?.text).toBe('');
    expect(page.rows[0]!.cells[columnId(right)]?.text).toBe('BR-001');
  });

  it('ruleStatus renders empty until requirement types validate anything (slice 12)', async () => {
    const column: MatrixColumn = { kind: 'ruleStatus' };
    const page = await run({ columns: [{ kind: 'key' }, column], query: "key = 'FN-001'" });
    expect(page.rows[0]!.cells[columnId(column)]?.text).toBe('');
  });

  it('groups rows by their defining document for the tree view', async () => {
    const page = await run({ columns: [{ kind: 'key' }], pageSize: 400 });
    const groups = groupRowsByDocument(page.rows);
    expect(groups.map((group) => group.documentTitle)).toContain('Functional specification');
    expect(groups.map((group) => group.documentTitle)).toContain('Business rules');
  });
});

describe('visibility inside the matrix (rules X1–X3)', () => {
  it('omits rows the reader may not see, and says so in the total', async () => {
    const owner = await run({ columns: [{ kind: 'key' }], query: "key ~ 'BR-1%'", pageSize: 200 });
    const stranger = await run({ columns: [{ kind: 'key' }], query: "key ~ 'BR-1%'", pageSize: 200, as: 'stranger' });

    expect(owner.rows.map((row) => row.key)).toContain('BR-101');
    expect(stranger.rows.map((row) => row.key)).not.toContain('BR-101');
    expect(stranger.total).toBeLessThan(owner.total);
  });

  it('rule X2: a link to a hidden requirement shows as restricted, not as a leak', async () => {
    const column: MatrixColumn = { kind: 'dependency', direction: 'to', depth: 1, render: 'key+title' };

    // FN-101 refines BR-101, which lives in the annex the stranger cannot read.
    const owner = await run({ columns: [{ kind: 'key' }, column], query: "key = 'FN-101'" });
    expect(owner.rows[0]!.cells[columnId(column)]?.text).toBe('BR-101 — Requirement BR-101');

    const stranger = await run({ columns: [{ kind: 'key' }, column], query: "key = 'FN-101'", as: 'stranger' });
    expect(stranger.rows[0]!.cells[columnId(column)]?.text).toBe('BR-101 — restricted');
  });
});

describe('$currentBaseline in an embedded matrix (spec 04 §2.3, RD-031)', () => {
  it('resolves to the baseline the embedding document reports on', async () => {
    await prisma.baseline.update({
      where: { id: fixture.baselineId },
      data: { reportDocumentId: fixture.documentIds[0]! },
    });

    const inReport = await run({
      columns: [{ kind: 'key' }],
      query: 'baseline = $currentBaseline',
      documentId: fixture.documentIds[0]!,
      pageSize: 100,
    });
    expect(inReport.total).toBe(20);

    // The same saved query in a document that reports on no baseline shows the live set
    // (RD-031). Naming `baseline` drops the ACTIVE default, so every live row counts —
    // including the DELETED ones (spec 02 §8 rule 4).
    const elsewhere = await run({
      columns: [{ kind: 'key' }],
      query: 'baseline = $currentBaseline',
      documentId: fixture.documentIds[1]!,
      pageSize: 100,
    });
    expect(elsewhere.total).toBe(TOTAL);
    expect(elsewhere.rows.map((row) => row.key)).not.toContain('FN-001 (frozen)');
  });

  it('renders the same saved matrix correctly in two documents', async () => {
    const saved = await prisma.savedMatrix.create({
      data: {
        spaceId: fixture.spaceId,
        name: `Embedded ${Date.now()}`,
        kind: 'TRACEABILITY',
        query: "key ~ 'FN-00%'",
        columns: [{ kind: 'key' }, { kind: 'title' }],
        visibility: 'space',
        ownerId: fixture.userId,
      },
    });

    const first = await run({
      columns: [{ kind: 'key' }, { kind: 'title' }],
      query: saved.query,
      documentId: fixture.documentIds[0]!,
    });
    const second = await run({
      columns: [{ kind: 'key' }, { kind: 'title' }],
      query: saved.query,
      documentId: fixture.documentIds[1]!,
    });

    expect(first.rows.map((row) => row.key)).toEqual(second.rows.map((row) => row.key));
    expect(first.rows.length).toBeGreaterThan(0);
  });
});

describe('xlsx export as a job (spec 04 §2.5)', () => {
  const payloadFor = (name: string) => ({
    spaceKey: fixture.spaceKey,
    spaceName: 'Corpus',
    classification: 'Official (Closed)',
    name,
    config: {
      query: "key ~ 'FN-0%'",
      columns: [{ kind: 'key' }, { kind: 'title' }, { kind: 'property', name: 'Category' }],
      pageSize: 50,
      treeView: false,
    },
    rowsPerPage: 50,
  });

  it('writes every matching row, in pages, with the classification label', async () => {
    const queued = await enqueueJob({
      kind: 'export-matrix',
      spaceId: fixture.spaceId,
      actorId: fixture.userId,
      payload: payloadFor('Functional export'),
    });

    await runJobNow(queued.id);
    const job = await findJob(queued.id);

    expect(job?.state).toBe('DONE');
    expect(job?.progress).toBe(100);
    expect(job?.resultRef).toMatch(/exports\/.+\.xlsx$/);

    const path = resolveStoredPath(job!.resultRef!);
    expect(path).not.toBeNull();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path!);
    const sheet = workbook.worksheets[0]!;

    expect(sheet.getRow(1).getCell(1).value).toBe('Classification: Official (Closed)');
    expect(sheet.getRow(3).values).toEqual([undefined, 'Key', 'Title', 'Category']);
    expect(sheet.getRow(4).getCell(1).value).toBe('FN-001');

    // Header rows are 3; the rest are data, paged 50 at a time.
    const expected = await run({ columns: [{ kind: 'key' }], query: "key ~ 'FN-0%'", pageSize: 600 });
    expect(sheet.rowCount - 3).toBe(expected.total);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 });
  }, 120_000);

  it('stops at a cancel request rather than finishing the file', async () => {
    const queued = await enqueueJob({
      kind: 'export-matrix',
      spaceId: fixture.spaceId,
      actorId: fixture.userId,
      payload: payloadFor('Cancelled export'),
    });
    await prisma.job.update({ where: { id: queued.id }, data: { cancelRequested: true } });

    await runJobNow(queued.id);
    const job = await findJob(queued.id);

    expect(job?.state).toBe('CANCELLED');
    expect(job?.resultRef).toBeNull();
  });

  it('fails the job when the person who queued it may no longer export', async () => {
    // A member with VIEW alone: the export is re-authorised when the job runs, not only
    // when it is queued.
    const viewer = await prisma.user.create({
      data: { email: `viewer-${Date.now()}@test`, name: 'Viewer', passwordHash: 'scrypt$x$y' },
    });
    await prisma.membership.create({
      data: { spaceId: fixture.spaceId, userId: viewer.id, permissions: ['VIEW'] },
    });

    const queued = await enqueueJob({
      kind: 'export-matrix',
      spaceId: fixture.spaceId,
      actorId: viewer.id,
      payload: payloadFor('Refused export'),
    });

    await runJobNow(queued.id);
    const job = await findJob(queued.id);

    expect(job?.state).toBe('FAILED');
    expect(job?.error).toContain('EXPORT');

    await prisma.membership.deleteMany({ where: { spaceId: fixture.spaceId, userId: viewer.id } });
    await prisma.user.delete({ where: { id: viewer.id } });
  });
});
