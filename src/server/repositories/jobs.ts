import type { Job, JobState, Prisma } from '@prisma/client';
import { prisma } from './client';

export type JobKind = 'export-matrix' | 'export-dependency-matrix' | 'revalidate-type' | 'freeze-baseline' | 'export-diff';

export async function enqueueJob(input: {
  kind: JobKind;
  spaceId: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}): Promise<Job> {
  return prisma.job.create({ data: { ...input, state: 'QUEUED' } });
}

/**
 * Takes the oldest queued job, atomically.
 * `FOR UPDATE SKIP LOCKED` is what makes it safe to run the in-process runner and a
 * separate `pnpm worker` at the same time: two runners never claim the same row.
 */
export async function claimNextJob(): Promise<Job | null> {
  const claimed = await prisma.$queryRaw<Job[]>`
    UPDATE "Job"
    SET "state" = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE "state" = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;
  return claimed[0] ?? null;
}

export async function claimJob(id: string): Promise<Job | null> {
  const claimed = await prisma.$queryRaw<Job[]>`
    UPDATE "Job"
    SET "state" = 'RUNNING', "startedAt" = now()
    WHERE id = ${id} AND "state" = 'QUEUED'
    RETURNING *
  `;
  return claimed[0] ?? null;
}

export async function reportProgress(id: string, progress: number, message?: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { progress: Math.min(Math.max(Math.trunc(progress), 0), 100), message: message ?? null },
  });
}

export async function finishJob(id: string, state: Extract<JobState, 'DONE' | 'CANCELLED'>, resultRef?: string) {
  await prisma.job.update({
    where: { id },
    data: {
      state,
      progress: state === 'DONE' ? 100 : undefined,
      resultRef: resultRef ?? null,
      finishedAt: new Date(),
    },
  });
}

export async function failJob(id: string, error: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { state: 'FAILED', error: error.slice(0, 2000), finishedAt: new Date() },
  });
}

export async function requestCancel(id: string, spaceId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id, spaceId, state: { in: ['QUEUED', 'RUNNING'] } },
    data: { cancelRequested: true },
  });
}

export async function isCancelRequested(id: string): Promise<boolean> {
  const job = await prisma.job.findUnique({ where: { id }, select: { cancelRequested: true } });
  return job?.cancelRequested === true;
}

export async function findJob(id: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id } });
}

export async function listJobs(spaceId: string, take = 20): Promise<Job[]> {
  return prisma.job.findMany({ where: { spaceId }, orderBy: { createdAt: 'desc' }, take });
}
