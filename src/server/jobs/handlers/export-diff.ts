import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { dependencyLines, propertyLines, setDiff, type DiffRow } from '@/domain/diff';
import { ensureStorageDir } from '../storage';
import type { ClassificationLabel } from '@/domain/classification';
import type { JobHandler } from '../runner';
import { LabelTracker, stampWorkbook } from './classification';

export type ExportDiffPayload = {
  spaceKey: string;
  spaceName: string;
  classification: string | null;
  left: string;
  right: string;
  request: unknown;
};

/** The diff pages over its classified rows; the comparison itself runs once. */
export type DiffExportPage = {
  rows: DiffRow[];
  total: number;
  summary: Record<string, number>;
  /** The highest label over both sides of the comparison (spec 07 §2.3). */
  label?: ClassificationLabel | null;
};

/**
 * The diff as an .xlsx.
 * spec: 05-baselines-and-diff.md §5.4 — "Diff export is `.xlsx` and runs as a job",
 * because beyond 2,000 rows the interactive path refuses; 07 §2.3 — every exported file
 * carries the classification label of the highest-classified content it contains.
 */
export const exportDiffHandler: JobHandler<ExportDiffPayload, DiffExportPage> = async (payload, context) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Reqforge';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Diff');
  if (payload.classification) {
    sheet.addRow([`Classification: ${payload.classification}`]);
    sheet.addRow([]);
  }
  sheet.addRow([`Left: ${payload.left}`]);
  sheet.addRow([`Right: ${payload.right}`]);
  sheet.addRow([]);
  sheet.addRow(['Key', 'Change', 'Fields', 'Before', 'After']).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: sheet.rowCount }];

  let written = 0;
  let offset = 0;
  const label = new LabelTracker();

  for (;;) {
    if (await context.cancelled()) return { cancelled: true };

    const page = await context.fetchPage(offset);
    if (page.rows.length === 0) break;

    label.see(page.label);
    for (const row of page.rows) {
      sheet.addRow([
        row.key,
        row.kind,
        row.changed.join(', '),
        describe(row.left),
        describe(row.right),
      ]);
    }

    written += page.rows.length;
    offset += page.rows.length;
    const percent = page.total > 0 ? Math.min(Math.round((written / page.total) * 100), 99) : 99;
    await context.progress(percent, `Wrote ${written} of ${page.total} rows.`);
    if (written >= page.total) break;
  }

  // The second sheet is the summary an auditor reads first: how much moved, and how.
  const summary = workbook.addWorksheet('Summary');
  summary.addRow(['Class', 'Count']).font = { bold: true };
  for (const [kind, count] of Object.entries(page0(payload))) summary.addRow([kind, count]);

  stampWorkbook(workbook, sheet, label.name(payload.classification), payload.classification);

  const directory = await ensureStorageDir('diffs');
  const name = `diff-${Date.now()}.xlsx`;
  await workbook.xlsx.writeFile(join(directory, name));

  await context.progress(100, `${written} row${written === 1 ? '' : 's'}.`);
  return { resultRef: join('diffs', name) };
};

/** Summary counts travel on the payload, since the comparison ran before the job. */
function page0(payload: ExportDiffPayload): Record<string, number> {
  const request = payload.request as { summary?: Record<string, number> } | undefined;
  return request?.summary ?? {};
}

/** One cell describing a side: its title, then what its property and edge sets held. */
function describe(row: DiffRow['left']): string {
  if (!row) return '—';
  const properties = propertyLines(row.inlineProperties);
  const dependencies = dependencyLines(row.dependencies);

  return [
    row.title,
    properties.length > 0 ? `properties: ${properties.join('; ')}` : null,
    dependencies.length > 0 ? `depends on: ${dependencies.join('; ')}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Re-exported so the page source can shape a set comparison the same way. */
export { setDiff };
