import { limitsForSpaceId } from '@/server/limits';
import type { Job } from '@prisma/client';
import { effectivePermissions, findSpaceById, findSpaceByKey } from '@/server/repositories/spaces';
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
  exportDiffHandler,
  type DiffExportPage,
  type ExportDiffPayload,
} from './handlers/export-diff';
import { runDiffForUser } from '@/server/usecases/diff';
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
import { captureBaselineLabel, labelForRequirements } from '@/server/repositories/classification';
import { snapshotGatesForBaseline } from '@/server/repositories/restrictions';
import { SYSTEM } from '@/server/repositories/visibility';
import { emitEventsNow } from '@/server/repositories/webhooks';
import { startWebhookDispatcher } from '@/server/webhooks/dispatcher';
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
  // spec 07 §2.3 — the export carries the label of the highest-classified row in it.
  const label = await labelForRequirements(result.page.rows.map((row) => row.id));
  return { rows: result.page.rows, total: result.page.total, label };
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
  const [edges, documents, label] = await Promise.all([
    fetchEdgesBetween(ids, axisIds),
    fetchDefiningDocuments(ids),
    // The axis is every row in the file, so its label is the file's (spec 07 §2.3).
    labelForRequirements(axisIds),
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
    label,
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
    countRequirementsOfType(payload.typeId, SYSTEM),
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

/**
 * The diff export runs the same comparison the screen runs, as the person who queued it,
 * so an export can never contain a row that person could not see (rule X3). The whole
 * comparison happens once and the pages are windows onto its rows.
 */
const diffPageSource: PageSource<DiffExportPage> = async (job, offset): Promise<DiffExportPage> => {
  const payload = job.payload as ExportDiffPayload;
  const space = await findSpaceByKey(payload.spaceKey);
  if (!space) throw new Error(`Space ${payload.spaceKey} no longer exists.`);

  const permissions = await effectivePermissions(job.actorId, space.id);
  if (!permissions.includes('EXPORT')) {
    throw new Error(`The person who queued this export no longer has EXPORT in ${payload.spaceKey}.`);
  }

  const result = await runDiffForUser({
    space: { id: space.id, key: space.key, isolated: space.isolated },
    userId: job.actorId,
    request: payload.request,
    maxRows: 20_000,
  });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'That comparison is no longer valid.');

  const rows = result.outcome.rows.slice(offset, offset + 500);
  // Both sides, not only the rows that changed: an unchanged row is still in the file.
  const label = offset === 0 ? await labelForRequirements(result.ids) : null;
  return { rows, total: result.outcome.rows.length, summary: result.outcome.summary, label };
};

import { renameHandler, setRenameWriter, type RenamePayload } from './handlers/rename';
import { reindexHandler, setReindexRunner, type ReindexPayload } from './handlers/reindex';
import { renameRequirements, RenameWasCancelled } from '@/server/repositories/rename';
import { findSpaceById as findSpaceForRename } from '@/server/repositories/spaces';

let registered = false;

/** Idempotent: both the web process and `pnpm worker` call this before running anything. */
async function renameLimits(spaceId: string): Promise<{ maxRequirements: number; maxDocuments: number }> {
  const limits = await limitsForSpaceId(spaceId);
  return { maxRequirements: limits.renameRequirements, maxDocuments: limits.renameDocuments };
}

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
      const space = await findSpaceById(baseline.spaceId);
      return writeFrozenBatch({
        spaceId: baseline.spaceId,
        baselineId: input.baselineId,
        rows: input.rows,
        includedExternal: input.includedExternal,
        actorId: input.actorId,
        historyEnabled: space?.historyEnabled ?? false,
      });
    },
    writeEdges: writeInternalEdges,
    writeDangling,
    markFrozen: async (baselineId, actorId) => {
      // Rule X4 (RD-059) and spec 07 §2.3 (RD-060): the restriction state and the label
      // are captured before the baseline is marked frozen, so a frozen baseline is never
      // visible without its frozen gates.
      await snapshotGatesForBaseline(baselineId);
      await captureBaselineLabel(baselineId);
      const frozen = await markFrozen(baselineId, actorId);
      // spec 08 §7 — after the freeze is committed; the baseline is its own record.
      await emitEventsNow([
        {
          type: 'baseline.frozen',
          spaceId: frozen.spaceId,
          actorId,
          data: { baselineNumber: frozen.number, baselineId },
        },
      ]);
    },
    clear: clearBaselineRows,
  });
  registerJobHandler<FreezePayload, FreezePage>('freeze-baseline', freezeHandler, freezePageSource);
  registerJobHandler<ExportDiffPayload, DiffExportPage>('export-diff', exportDiffHandler, diffPageSource);

  // The rename owns its transaction, so it has no page source (spec 03 §5).
  setRenameWriter({
    rename: async (payload: RenamePayload, jobId, hooks) => {
      const space = await findSpaceForRename(payload.spaceId);
      try {
        return await renameRequirements(
          {
            spaceId: payload.spaceId,
            spaceKey: payload.spaceKey,
            isolated: space?.isolated ?? false,
            actorId: payload.actorId,
            jobId,
            pairs: payload.pairs,
            historyEnabled: space?.historyEnabled ?? false,
            // Resolved when the job runs: a limit lowered since it was queued still applies.
            ...(await renameLimits(payload.spaceId)),
          },
          hooks,
        );
      } catch (error) {
        if (error instanceof RenameWasCancelled) return 'cancelled';
        throw error;
      }
    },
  });
  registerJobHandler<RenamePayload, never>('rename-key', renameHandler);

  // RD-070 — imported lazily: the documents use case imports this module to register
  // handlers, so a static import would be a cycle.
  setReindexRunner(async (payload) => {
    const { runReindex } = await import('@/server/usecases/documents');
    return runReindex(payload);
  });
  registerJobHandler<ReindexPayload & { actorId?: string }, never>('reindex-document', reindexHandler);

  // spec 08 §7 — deliveries move wherever jobs do.
  startWebhookDispatcher();

  registered = true;
}

async function baselineOrThrow(baselineId: string) {
  const baseline = await findBaseline(baselineId);
  if (!baseline) throw new Error('That baseline no longer exists.');
  return baseline;
}
