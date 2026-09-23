import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { columnLabel, parseMatrixConfig, toSheetRows } from '@/domain/traceability/matrix';
import { ensureStorageDir } from '../storage';
import type { JobHandler } from '../runner';
import { LabelTracker, stampWorkbook } from './classification';

export type ExportMatrixPayload = {
  spaceKey: string;
  spaceName: string;
  classification: string | null;
  name: string;
  config: unknown;
  /** Serialised rows, page by page, produced by the use case that enqueued the job. */
  rowsPerPage: number;
};

/**
 * Exports a traceability matrix to .xlsx.
 * spec: 04-traceability-and-coverage.md §2.5 ("Export to .xlsx runs as a job, not a
 * request") and 07 §2.3 (every exported file carries the classification label of the
 * highest-classified content it contains).
 */
export const exportMatrixHandler: JobHandler<ExportMatrixPayload> = async (payload, context) => {
  const config = parseMatrixConfig(payload.config);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Reqforge';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(payload.name.slice(0, 28) || 'Matrix');

  if (payload.classification) {
    sheet.addRow([`Classification: ${payload.classification}`]);
    sheet.addRow([]);
  }
  sheet.addRow(config.columns.map(columnLabel)).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: sheet.rowCount }];

  let written = 0;
  let offset = 0;
  const label = new LabelTracker();

  for (;;) {
    if (await context.cancelled()) return { cancelled: true };

    const page = await context.fetchPage(offset);
    if (page.rows.length === 0) break;

    label.see(page.label);
    // toSheetRows is the same shaping the screen renders, minus its header row.
    for (const row of toSheetRows(config, page.rows).slice(1)) sheet.addRow(row);

    written += page.rows.length;
    offset += page.rows.length;
    await context.progress(page.total === 0 ? 100 : Math.round((written / page.total) * 100), `${written} of ${page.total} rows`);

    if (written >= page.total) break;
  }

  sheet.columns.forEach((column) => {
    column.width = Math.min(Math.max(String(column.values?.[1] ?? '').length + 4, 14), 60);
  });

  stampWorkbook(workbook, sheet, label.name(payload.classification), payload.classification);

  const directory = await ensureStorageDir('exports', context.jobId);
  const fileName = `${payload.name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'matrix'}.xlsx`;
  await workbook.xlsx.writeFile(join(directory, fileName));

  return { resultRef: join('exports', context.jobId, fileName) };
};
