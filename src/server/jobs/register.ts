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
import {
  freezeHandler,
  setFreezeWriter,
  type FreezePage,
  type FreezePayload,
} from './handlers/freeze';
import { partitionDependencies } from '@/domain/baselines';
import {
  clearBaselineRows,
  loadEdges,
  loadMembers,
  markFrozen,
  writeDangling,
  writeFrozenBatch,
  writeInternalEdges,
  findBaseline,
} from '@/server/repositories/baselines';
import {
  revalidateTypeHandler,
  setRevalidateWriter,
  type RevalidatePage,
  type RevalidateTypePayload,
} from './handlers/revalidate-type';
import { findTypeWithRules, requirementsOfType, countRequirementsOfType, rulesOf } from '@/server/repositories/requirement-types';
import { fetchValidationSubjects, writeValidationsOutsideTransaction } from '@/server/repositories/validations';
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

/**
 * A page of a revalidation run: the type's rules plus one window of its requirements with
 * their properties and edges, loaded in batched queries (spec 06 §2.3). The permission is
 * re-checked at run time, exactly as the export sources re-check EXPORT.
 */
const revalidatePageSource: PageSource<RevalidatePage> = async (job, offset): Promise<RevalidatePage> => {
  const payload = job.payload as RevalidateTypePayload;
  const space = await findSpaceByKey(payload.spaceKey);
  if (!space) throw new Error(`Space ${payload.spaceKey} no longer exists.`);

  const permissions = await effectivePermissions(job.actorId, space.id);
  if (!permissions.includes('EDIT')) {
    throw new Error(`The person who queued this run no longer has EDIT in ${payload.spaceKey}.`);
  }

  const type = await findTypeWithRules(space.id, payload.typeId);
  if (!type) throw new Error('That requirement type no longer exists.');

  const [rows, total] = await Promise.all([
    requirementsOfType(payload.typeId, offset, payload.pageSize),
    countRequirementsOfType(payload.typeId),
  ]);

  const subjects = await fetchValidationSubjects(rows);
  return { rules: rulesOf(type), total, subjects };
};

/**
 * One batch of a freeze: the live rows behind a window of the member set, and the edges
 * those rows declare, partitioned against the whole member set.
 * spec 05 §3.2 — the member set is fixed when Freeze is pressed, so it travels in the
 * payload rather than being re-resolved per page: a query whose answer changed mid-run
 * would otherwise freeze a set nobody chose.
 */
const freezePageSource: PageSource<FreezePage> = async (job, offset): Promise<FreezePage> => {
  const payload = job.payload as FreezePayload;
  const space = await findSpaceByKey(payload.spaceKey);
  if (!space) throw new Error(`Space ${payload.spaceKey} no longer exists.`);

  const permissions = await effectivePermissions(job.actorId, space.id);
  if (!permissions.includes('ADMIN')) {
    throw new Error(`The person who queued this freeze no longer has ADMIN in ${payload.spaceKey}.`);
  }

  const batchKeys = payload.memberKeys.slice(offset, offset + payload.batchSize);
  if (batchKeys.length === 0) {
    return { rows: [], internal: [], dangling: [], total: payload.memberKeys.length };
  }

  const [rows, edges] = await Promise.all([
    loadMembers(space.id, batchKeys),
    loadEdges(space.id, batchKeys),
  ]);
  // Partitioned against the *whole* member set, not this batch: a parent in a later
  // batch is a member, and its edge is internal.
  const { internal, dangling } = partitionDependencies(edges, payload.memberKeys);

  return { rows, internal, dangling, total: payload.memberKeys.length };
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
  // The handler stays free of database imports; the writer is injected here, where the
  // repository layer already lives.
  setRevalidateWriter(writeValidationsOutsideTransaction);
  registerJobHandler<RevalidateTypePayload, RevalidatePage>(
    'revalidate-type',
    revalidateTypeHandler,
    revalidatePageSource,
  );

  // The freeze handler fetches images and shapes bodies; every database write it needs is
  // injected here, where the repository layer already lives.
  setFreezeWriter({
    writeBatch: async (input) => {
      const baseline = await baselineOrThrow(input.baselineId);
      return writeFrozenBatch({
        spaceId: baseline.spaceId,
        baselineId: input.baselineId,
        rows: input.rows,
        includedExternal: input.includedExternal,
      });
    },
    writeEdges: writeInternalEdges,
    writeDangling,
    markFrozen: async (baselineId, actorId) => {
      await markFrozen(baselineId, actorId);
    },
    clear: clearBaselineRows,
  });
  registerJobHandler<FreezePayload, FreezePage>('freeze-baseline', freezeHandler, freezePageSource);

  registered = true;
}

async function baselineOrThrow(baselineId: string) {
  const baseline = await findBaseline(baselineId);
  if (!baseline) throw new Error('That baseline no longer exists.');
  return baseline;
}
