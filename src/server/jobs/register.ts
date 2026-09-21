import type { Job } from '@prisma/client';
import { effectivePermissions, findSpaceByKey } from '@/server/repositories/spaces';
import { runMatrixForUser } from '@/server/usecases/matrix';
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

let registered = false;

/** Idempotent: both the web process and `pnpm worker` call this before running anything. */
export function registerJobHandlers(): void {
  if (registered) return;
  registerJobHandler<ExportMatrixPayload>('export-matrix', exportMatrixHandler, matrixPageSource);
  registered = true;
}
