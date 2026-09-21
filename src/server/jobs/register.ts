import type { Job } from '@prisma/client';
import { effectivePermissions, findSpaceByKey } from '@/server/repositories/spaces';
import { runMatrixForUser } from '@/server/usecases/matrix';
import { fetchDefiningDocuments, fetchEdgesBetween } from '@/server/repositories/traceability';
import { dependencyMatrixForUser } from '@/server/usecases/dependency-matrix';
import {
  exportDependencyMatrixHandler,
  type DependencyExportPage,
  type ExportDependencyMatrixPayload,
} from './handlers/export-dependency-matrix';
import { exportMatrixHandler, type ExportMatrixPayload } from './handlers/export-matrix';
import { registerJobHandler, type JobPage, type PageSource } from './runner';

/**
 * Pages for an export come from the same matrix code the screen uses, run as the person
 * who queued the job — so an export can never contain a row that person could not see
 * (rule X3). The permission is re-checked at run time, because a worker may pick the job
 * up long after it was queued.
 */
const matrixPageSource: PageSource = async (job: Job, offset: number): Promise<JobPage> => {
  const payload = job.payload as ExportMatrixPayload;
  const space = await findSpaceByKey(payload.spaceKey);
  if (!space) throw new Error(`Space ${payload.spaceKey} no longer exists.`);

  const permissions = await effectivePermissions(job.actorId, space.id);
  if (!permissions.includes('EXPORT')) {
    throw new Error(`The person who queued this export no longer has EXPORT in ${payload.spaceKey}.`);
  }

  const result = await runMatrixForUser({
    space: { id: space.id, key: space.key, isolated: space.isolated },
    userId: job.actorId,
    config: payload.config,
    offset,
  });

  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'The matrix query is no longer valid.');
  return { rows: result.page.rows, total: result.page.total };
};

/**
 * The dependency matrix pages over rows of the grid, but every page needs the full axis
 * and the edges those rows have into it — so a page carries both.
 */
const dependencyMatrixPageSource: PageSource<DependencyExportPage> = async (
  job: Job,
  offset: number,
): Promise<DependencyExportPage> => {
  const payload = job.payload as ExportDependencyMatrixPayload;
  const space = await findSpaceByKey(payload.spaceKey);
  if (!space) throw new Error(`Space ${payload.spaceKey} no longer exists.`);

  const permissions = await effectivePermissions(job.actorId, space.id);
  if (!permissions.includes('EXPORT')) {
    throw new Error(`The person who queued this export no longer has EXPORT in ${payload.spaceKey}.`);
  }

  const context = {
    space: { id: space.id, key: space.key, isolated: space.isolated },
    userId: job.actorId,
    query: payload.query,
  };

  // The axis is the whole population, in key order; the page is a window onto its rows.
  const axisPage = await dependencyMatrixForUser({ ...context, offset: 0, limit: 600 });
  const axisRows = [...axisPage.rows];

  while (axisRows.length < axisPage.total) {
    const next = await dependencyMatrixForUser({ ...context, offset: axisRows.length, limit: 600 });
    if (next.rows.length === 0) break;
    axisRows.push(...next.rows);
  }

  const axis = axisRows.map((row) => ({ key: row.key, title: row.title }));
  const axisIds = axisRows.map((row) => row.id);

  const page = await dependencyMatrixForUser({ ...context, offset, limit: payload.pageSize });
  const ids = page.rows.map((row) => row.id);
  // Edges from this page of rows to *any* column of the axis, not just to this page.
  const [edges, documents] = await Promise.all([
    fetchEdgesBetween(ids, axisIds),
    fetchDefiningDocuments(ids),
  ]);

  return {
    axis,
    rows: page.rows.map((row) => ({ key: row.key, title: row.title })),
    // Only edges whose far end is in the axis belong in the grid; buildGrid filters the rest.
    edges,
    documentTitles: page.rows
      .map((row): [string, string] => [row.key, documents.get(row.id)?.documentTitle ?? ''])
      .filter(([, title]) => title.length > 0),
    total: page.total,
  };
};

let registered = false;

/** Idempotent: both the web process and `pnpm worker` call this before running anything. */
export function registerJobHandlers(): void {
  if (registered) return;
  registerJobHandler<ExportMatrixPayload>('export-matrix', exportMatrixHandler, matrixPageSource);
  registerJobHandler<ExportDependencyMatrixPayload, DependencyExportPage>(
    'export-dependency-matrix',
    exportDependencyMatrixHandler,
    dependencyMatrixPageSource,
  );
  registered = true;
}
