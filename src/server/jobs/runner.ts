import type { Job } from '@prisma/client';
import type { MatrixRow } from '@/domain/traceability/matrix';
import {
  claimJob,
  claimNextJob,
  failJob,
  finishJob,
  isCancelRequested,
  reportProgress,
} from '@/server/repositories/jobs';

/** What a traceability-matrix export pages over. */
export type JobPage = { rows: MatrixRow[]; total: number };

export type JobContext<TPage = JobPage> = {
  jobId: string;
  /** Checked between pages: a job stops where it is rather than at the end. */
  cancelled: () => Promise<boolean>;
  progress: (percent: number, message?: string) => Promise<void>;
  /** Supplied by the job's kind — each kind decides what a page of its work is. */
  fetchPage: (offset: number) => Promise<TPage>;
};

export type JobOutcome = { resultRef?: string; cancelled?: boolean };

export type JobHandler<TPayload, TPage = JobPage> = (
  payload: TPayload,
  context: JobContext<TPage>,
) => Promise<JobOutcome>;

/**
 * How a job's pages are produced. The handler itself never touches the database: the
 * page source is registered by the use case that knows how to authorise the read, so a
 * job can never see more than the person who queued it.
 */
export type PageSource<TPage = JobPage> = (job: Job, offset: number) => Promise<TPage>;

// Erased at the boundary: each kind's handler and page source agree on the page type,
// and `registerJobHandler` is the only place that pairs them.
const handlers = new Map<string, JobHandler<never, never>>();
const pageSources = new Map<string, PageSource<never>>();

export function registerJobHandler<TPayload, TPage = JobPage>(
  kind: string,
  handler: JobHandler<TPayload, TPage>,
  pageSource: PageSource<TPage>,
): void {
  handlers.set(kind, handler as unknown as JobHandler<never, never>);
  pageSources.set(kind, pageSource as unknown as PageSource<never>);
}

/** Runs one already-claimed job to completion. */
export async function runClaimedJob(job: Job): Promise<void> {
  const handler = handlers.get(job.kind);
  const pageSource = pageSources.get(job.kind);

  if (!handler || !pageSource) {
    await failJob(job.id, `No handler is registered for job kind "${job.kind}".`);
    return;
  }

  const context: JobContext<unknown> = {
    jobId: job.id,
    cancelled: () => isCancelRequested(job.id),
    progress: (percent, message) => reportProgress(job.id, percent, message),
    fetchPage: (offset) => (pageSource as unknown as PageSource<unknown>)(job, offset),
  };

  try {
    const outcome = await (handler as unknown as JobHandler<unknown, unknown>)(job.payload, context);
    if (outcome.cancelled) {
      await finishJob(job.id, 'CANCELLED');
      return;
    }
    await finishJob(job.id, 'DONE', outcome.resultRef);
  } catch (error) {
    await failJob(job.id, error instanceof Error ? error.message : String(error));
  }
}

/** Claims and runs one queued job. Returns false when the queue is empty. */
export async function runNextJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  await runClaimedJob(job);
  return true;
}

/** Runs a specific job now — the inline path used by `JOBS_INLINE=1` and by tests. */
export async function runJobNow(id: string): Promise<void> {
  const job = await claimJob(id);
  if (job) await runClaimedJob(job);
}

export function jobsRunInline(): boolean {
  return process.env.JOBS_INLINE === '1' || process.env.NODE_ENV === 'test';
}

export async function drainQueue(limit = 50): Promise<number> {
  let ran = 0;
  while (ran < limit && (await runNextJob())) ran += 1;
  return ran;
}
