import type { Job } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import { parseMatrixConfig } from '@/domain/traceability/matrix';
import { parseDiffRequest } from '@/domain/diff';
import { requireSpace } from '@/server/authz';
import { registerJobHandlers } from '@/server/jobs/register';
import { jobsRunInline, runJobNow } from '@/server/jobs/runner';
import { enqueueJob, findJob, listJobs, requestCancel } from '@/server/repositories/jobs';

/**
 * Queues the xlsx export of a traceability matrix.
 * spec: 04-traceability-and-coverage.md §2.5 — "Export to .xlsx runs as a job, not a
 * request"; 07 §2.1 — exports need the EXPORT permission.
 */
export async function exportMatrixUseCase(input: {
  spaceKey: string;
  name: unknown;
  config: unknown;
}): Promise<Job> {
  const { space, user } = await requireSpace(input.spaceKey, 'EXPORT');
  const config = parseMatrixConfig(input.config);
  if (config.query.trim().length === 0) throw new ValidationError('An export needs a query.');

  registerJobHandlers();

  const job = await enqueueJob({
    kind: 'export-matrix',
    spaceId: space.id,
    actorId: user.id,
    payload: {
      spaceKey: space.key,
      spaceName: space.name,
      classification: space.classification,
      name: typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : 'Traceability matrix',
      config: { ...config },
      rowsPerPage: config.pageSize,
    },
  });

  if (jobsRunInline()) {
    // Dev and tests run the job to completion here, so behaviour is deterministic without
    // a second process. In production `pnpm worker` claims it instead.
    await runJobNow(job.id);
  } else {
    void runJobNow(job.id);
  }

  return (await findJob(job.id)) ?? job;
}

/** spec 04 §3 — the grid's export, with no cell cap and the axis limit of RD/spec 07 §4. */
export async function exportDependencyMatrixUseCase(input: {
  spaceKey: string;
  query: unknown;
}): Promise<Job> {
  const { space, user } = await requireSpace(input.spaceKey, 'EXPORT');
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (query.length === 0) throw new ValidationError('An export needs a query.');

  registerJobHandlers();

  const job = await enqueueJob({
    kind: 'export-dependency-matrix',
    spaceId: space.id,
    actorId: user.id,
    payload: {
      spaceKey: space.key,
      classification: space.classification,
      name: 'Dependency matrix',
      query,
      pageSize: 200,
    },
  });

  if (jobsRunInline()) await runJobNow(job.id);
  else void runJobNow(job.id);

  return (await findJob(job.id)) ?? job;
}

export async function jobStatusUseCase(spaceKey: string, jobId: string): Promise<Job> {
  const { space } = await requireSpace(spaceKey);
  const job = await findJob(jobId);
  if (!job || job.spaceId !== space.id) throw new NotFoundError('That job does not exist in this space.');
  return job;
}

export async function listJobsUseCase(spaceKey: string): Promise<Job[]> {
  const { space } = await requireSpace(spaceKey);
  return listJobs(space.id);
}

export async function cancelJobUseCase(spaceKey: string, jobId: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey);
  const job = await findJob(jobId);
  if (!job || job.spaceId !== space.id) throw new NotFoundError('That job does not exist in this space.');
  if (job.actorId !== user.id) throw new ForbiddenError('Only the person who started a job can cancel it.');
  await requestCancel(jobId, space.id);
}

/** spec 05 §5.4 — "Diff export is `.xlsx` and runs as a job". */
export async function exportDiffUseCase(input: { spaceKey: string; request: unknown }): Promise<Job> {
  const { space, user } = await requireSpace(input.spaceKey, 'EXPORT');
  const request = parseDiffRequest(input.request);
  if (request.left.length === 0 || request.right.length === 0) {
    throw new ValidationError('A diff needs a query on each side.');
  }

  registerJobHandlers();

  const job = await enqueueJob({
    kind: 'export-diff',
    spaceId: space.id,
    actorId: user.id,
    payload: {
      spaceKey: space.key,
      spaceName: space.name,
      classification: space.classification,
      left: request.left,
      right: request.right,
      request: { ...request },
    },
  });

  if (jobsRunInline()) await runJobNow(job.id);
  else void runJobNow(job.id);

  return (await findJob(job.id)) ?? job;
}
