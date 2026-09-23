import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildGrid,
  cellInitials,
  EXPORT_AXIS_CAP,
  type GridAxisEntry,
  type GridEdge,
} from '@/domain/traceability/dependency-matrix';
import { ensureStorageDir } from '../storage';
import type { ClassificationLabel } from '@/domain/classification';
import type { JobHandler } from '../runner';
import { LabelTracker, stampWorkbook } from './classification';

export type ExportDependencyMatrixPayload = {
  spaceKey: string;
  classification: string | null;
  name: string;
  query: string;
  pageSize: number;
};

/** One page of the export: rows of the grid, plus the axis and the edges they need. */
export type DependencyExportPage = {
  axis: GridAxisEntry[];
  rows: GridAxisEntry[];
  edges: GridEdge[];
  documentTitles: Array<[string, string]>;
  total: number;
  /** The highest label among the axis rows (spec 07 §2.3). */
  label?: ClassificationLabel | null;
};

function baseUrl(): string {
  return (process.env.REQFORGE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * The dependency matrix as .xlsx: two sheets, frozen panes, hyperlinks back into the app.
 * spec: 04-traceability-and-coverage.md §3 — the export has no 40,000-cell cap; it has a
 * hard axis limit of 5,000, the size research §4.3 says RY tested.
 */
export const exportDependencyMatrixHandler: JobHandler<ExportDependencyMatrixPayload, DependencyExportPage> = async (
  payload,
  context,
) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Reqforge';
  workbook.created = new Date();

  const matrix = workbook.addWorksheet('Matrix');
  const legend = workbook.addWorksheet('Legend');

  const first = await context.fetchPage(0);
  if (first.total > EXPORT_AXIS_CAP) {
    // spec 07 §4 — a hard limit is an error naming the limit.
    throw new Error(
      `That query matches ${first.total} requirements; the dependency matrix export is limited to ${EXPORT_AXIS_CAP}.`,
    );
  }

  const axis = first.axis;
  const label = new LabelTracker();
  label.see(first.label);
  const documentTitles = new Map(first.documentTitles);
  const relationships = new Set<string>();

  if (payload.classification) {
    // spec 07 §2.3 — every exported file carries its classification label.
    matrix.addRow([`Classification: ${payload.classification}`]);
    matrix.addRow([]);
  }

  const headerRow = matrix.addRow(['', ...axis.map((entry) => entry.key)]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, column) => {
    const entry = axis[column - 2];
    if (!entry) return;
    cell.value = { text: entry.key, hyperlink: `${baseUrl()}/s/${payload.spaceKey}/r/${encodeURIComponent(entry.key)}` };
  });

  // Freeze the header row and the key column, so a wide grid stays readable.
  matrix.views = [{ state: 'frozen', xSplit: 1, ySplit: matrix.rowCount }];

  let written = 0;
  let offset = 0;

  for (;;) {
    if (await context.cancelled()) return { cancelled: true };

    const page = offset === 0 ? first : await context.fetchPage(offset);
    if (page.rows.length === 0) break;

    for (const [key, title] of page.documentTitles) documentTitles.set(key, title);
    for (const edge of page.edges) relationships.add(edge.relationship);

    // The grid for this page of rows, against the full axis.
    const grid = buildGrid(axis, page.edges);

    for (const row of page.rows) {
      const excelRow = matrix.addRow([row.key, ...axis.map((column) => cellInitials(grid, row.key, column.key))]);
      excelRow.getCell(1).value = {
        text: row.key,
        hyperlink: `${baseUrl()}/s/${payload.spaceKey}/r/${encodeURIComponent(row.key)}`,
      };
    }

    written += page.rows.length;
    offset += page.rows.length;
    await context.progress(Math.round((written / Math.max(page.total, 1)) * 100), `${written} of ${page.total} rows`);

    if (written >= page.total) break;
  }

  // Sheet two: the legend, then the requirement list.
  const fullGrid = buildGrid(axis, [...relationships].map((relationship) => ({ fromKey: '', toKey: '', relationship })));
  legend.addRow(['Initials', 'Relationship']).font = { bold: true };
  for (const entry of fullGrid.legend) legend.addRow([entry.initials, entry.relationship]);
  legend.addRow([]);
  legend.addRow(['Key', 'Title', 'Document']).font = { bold: true };
  for (const entry of axis) legend.addRow([entry.key, entry.title, documentTitles.get(entry.key) ?? '']);
  legend.views = [{ state: 'frozen', ySplit: 1 }];
  legend.columns.forEach((column) => {
    column.width = 32;
  });

  stampWorkbook(workbook, matrix, label.name(payload.classification), payload.classification);

  const directory = await ensureStorageDir('exports', context.jobId);
  const fileName = `${payload.name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'dependency-matrix'}.xlsx`;
  await workbook.xlsx.writeFile(join(directory, fileName));

  return { resultRef: join('exports', context.jobId, fileName) };
};
