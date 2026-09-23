import type { Job, Prisma } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import { parseMatrixConfig } from '@/domain/traceability/matrix';
import { parseDiffRequest } from '@/domain/diff';
import { requireSpace, requireUser } from '@/server/authz';
import { findSpaceById } from '@/server/repositories/spaces';
import { recordAuditEvent } from '@/server/repositories/audit';
import { spaceLabel } from '@/server/repositories/classification';
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
      classification: (await spaceLabel(space.id))?.name ?? null,
      name: typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : 'Traceability matrix',
      config: { ...config },
      rowsPerPage: config.pageSize,
    },
  });
  await auditExportQueued(job);

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
      classification: (await spaceLabel(space.id))?.name ?? null,
      name: 'Dependency matrix',
      query,
      pageSize: 200,
    },
  });
  await auditExportQueued(job);

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
      classification: (await spaceLabel(space.id))?.name ?? null,
      left: request.left,
      right: request.right,
      request: { ...request },
    },
  });
  await auditExportQueued(job);

  if (jobsRunInline()) await runJobNow(job.id);
  else void runJobNow(job.id);

  return (await findJob(job.id)) ?? job;
}


/**
 * A finished export, for its download route.
 * spec 07 §2.1 — exports need EXPORT, re-checked here, so a download URL is not a way
 * around the permission that produced the file. And only the person who **queued** the
 * export may download it: the file holds what *they* could see (rule X3), which another
 * EXPORT holder may not be allowed to (RD-064's "not found", so its existence is not
 * confirmed either). spec 07 §6 — the download is audited.
 */
export async function downloadExportUseCase(spaceKey: string, jobId: string): Promise<{ resultRef: string }> {
  const { space, user } = await requireSpace(spaceKey, 'EXPORT');
  const job = await findJob(jobId);
  if (!job || job.spaceId !== space.id || job.actorId !== user.id) {
    throw new NotFoundError('No such export.');
  }
  if (job.state !== 'DONE' || !job.resultRef) {
    throw new ConflictError(`That export is ${job.state.toLowerCase()}.`);
  }
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Export',
    objectId: job.id,
    operation: 'download',
    parameters: { kind: job.kind, resultRef: job.resultRef },
  });
  return { resultRef: job.resultRef };
}

/** spec 07 §6 — "export" is one of the operations an auditor will ask about. */
async function auditExportQueued(job: Job): Promise<void> {
  await recordAuditEvent({
    actorId: job.actorId,
    spaceId: job.spaceId,
    objectType: 'Export',
    objectId: job.id,
    operation: 'queue',
    parameters: { kind: job.kind, payload: job.payload ?? {} } as Prisma.InputJsonValue,
  });
}

/**
 * spec 08 §6 — `/jobs/{id}` is addressed by id alone, with no space in the path. A job
 * belongs to the person who queued it: anyone else gets 404, not 403 (RD-064), and so does
 * that person once they lose VIEW on the job's space.
 */
export async function myJobUseCase(jobId: string): Promise<{ job: Job; spaceKey: string }> {
  const user = await requireUser();
  const job = await findJob(jobId);
  if (!job || job.actorId !== user.id || !job.spaceId) throw new NotFoundError('No such job.');
  const space = await findSpaceById(job.spaceId);
  if (!space) throw new NotFoundError('No such job.');
  await requireSpace(space.key);
  return { job, spaceKey: space.key };
}

/**
 * The checks of a download without the download: EXPORT, ownership, DONE. The API's
 * `/result` redirect uses it so that only the artefact itself records the download
 * (RD-062), once.
 */
export async function assertExportReadyUseCase(jobId: string): Promise<void> {
  const { job, spaceKey } = await myJobUseCase(jobId);
  await requireSpace(spaceKey, 'EXPORT');
  if (job.state !== 'DONE' || !job.resultRef) {
    throw new ConflictError(`That export is ${job.state.toLowerCase()}.`);
  }
}
