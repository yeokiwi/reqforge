import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { EXPORT_AXIS_CAP } from '@/domain/traceability/dependency-matrix';
import {
  exportDependencyMatrixHandler,
  type DependencyExportPage,
} from '@/server/jobs/handlers/export-dependency-matrix';
import { registerJobHandlers } from '@/server/jobs/register';
import { runJobNow } from '@/server/jobs/runner';
import { resolveStoredPath } from '@/server/jobs/storage';
import { prisma } from '@/server/repositories/client';
import { enqueueJob, findJob } from '@/server/repositories/jobs';
import { createCorpusSpace, dropCorpusSpace, type FixtureHandles } from './fixtures/corpus-space';

let fixture: FixtureHandles;

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
  registerJobHandlers();
}, 120_000);

afterAll(async () => {
  await prisma.job.deleteMany({ where: { spaceId: fixture.spaceId } });
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

/** spec: 04-traceability-and-coverage.md §3 — "two sheets, frozen panes, hyperlinks". */
describe('the dependency matrix export', () => {
  it('writes the grid and the legend, frozen and hyperlinked', async () => {
    const queued = await enqueueJob({
      kind: 'export-dependency-matrix',
      spaceId: fixture.spaceId,
      actorId: fixture.userId,
      payload: {
        spaceKey: fixture.spaceKey,
        classification: 'Official (Closed)',
        name: 'Dependency matrix',
        query: "key IN ('FN-001', 'FN-002', 'BR-001', 'BR-002')",
        pageSize: 2, // forces more than one page, so the paging path is exercised
      },
    });

    await runJobNow(queued.id);
    const job = await findJob(queued.id);
    expect(job?.state).toBe('DONE');

    const path = resolveStoredPath(job!.resultRef!);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path!);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Matrix', 'Legend']);

    const matrix = workbook.getWorksheet('Matrix')!;
    // Row 1 is the classification label (spec 07 §2.3), row 2 blank, row 3 the header.
    expect(matrix.getRow(1).getCell(1).value).toBe('Classification: Official (Closed)');
    expect(matrix.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 3 });

    const header = matrix.getRow(3);
    expect(header.getCell(2).value).toMatchObject({ text: 'BR-001' });
    expect((header.getCell(2).value as { hyperlink: string }).hyperlink).toContain(
      `/s/${fixture.spaceKey}/r/BR-001`,
    );

    // FN-001 refines BR-001, so its row carries the relationship's initials.
    const keyColumn = matrix.getColumn(1).values.map((value) =>
      typeof value === 'object' && value !== null && 'text' in value ? (value as { text: string }).text : value,
    );
    const fnRow = keyColumn.indexOf('FN-001');
    expect(fnRow).toBeGreaterThan(0);
    expect(matrix.getRow(fnRow).getCell(2).value).toBe('RE');
    // And not the other way round (invariant P1).
    const brRow = keyColumn.indexOf('BR-001');
    expect(matrix.getRow(brRow).getCell(3).value ?? '').toBe('');

    const legend = workbook.getWorksheet('Legend')!;
    expect(legend.getRow(1).values).toEqual([undefined, 'Initials', 'Relationship']);
    expect(legend.getRow(2).values).toEqual([undefined, 'RE', 'refines']);
    const legendText = legend.getSheetValues().flat().join(' ');
    expect(legendText).toContain('FN-001');
    expect(legendText).toContain('Functional specification');
  }, 120_000);

  it('refuses an axis over the 5,000 limit, naming it (spec 07 §4)', async () => {
    const page: DependencyExportPage = {
      axis: [],
      rows: [],
      edges: [],
      documentTitles: [],
      total: EXPORT_AXIS_CAP + 1,
    };

    await expect(
      exportDependencyMatrixHandler(
        {
          spaceKey: 'SJ',
          classification: null,
          name: 'Too big',
          query: "key ~ '%'",
          pageSize: 200,
        },
        {
          jobId: 'job-test',
          cancelled: async () => false,
          progress: async () => undefined,
          fetchPage: async () => page,
        },
      ),
    ).rejects.toThrow(new RegExp(`"Dependency matrix export axis" limit exceeded: .*the limit is ${EXPORT_AXIS_CAP.toLocaleString('en-US')}`));
  });

  it('stops on a cancel request', async () => {
    const queued = await enqueueJob({
      kind: 'export-dependency-matrix',
      spaceId: fixture.spaceId,
      actorId: fixture.userId,
      payload: {
        spaceKey: fixture.spaceKey,
        classification: null,
        name: 'Cancelled grid',
        query: "key IN ('FN-001', 'BR-001')",
        pageSize: 1,
      },
    });
    await prisma.job.update({ where: { id: queued.id }, data: { cancelRequested: true } });

    await runJobNow(queued.id);
    const job = await findJob(queued.id);
    expect(job?.state).toBe('CANCELLED');
    expect(job?.resultRef).toBeNull();
  }, 120_000);
});
