'use server';

import { isAppError } from '@/domain/errors';
import type { DiffFailure, DiffSuccess } from '@/server/usecases/diff';
import { runDiff } from '@/server/usecases/diff';
import { exportDiffUseCase, jobStatusUseCase } from '@/server/usecases/jobs';

export type DiffResponse = DiffSuccess | DiffFailure | { ok: false; refused: string };

export async function runDiffAction(spaceKey: string, request: unknown): Promise<DiffResponse> {
  try {
    return await runDiff({ spaceKey, request });
  } catch (error) {
    // spec 05 §5.4 — above the threshold the interactive path refuses and names the export.
    if (isAppError(error)) return { ok: false, refused: error.message };
    throw error;
  }
}

export type DiffJobView = {
  id: string;
  state: string;
  progress: number;
  message: string | null;
  error: string | null;
  downloadHref: string | null;
};

export async function exportDiffAction(
  spaceKey: string,
  request: unknown,
): Promise<DiffJobView | { failed: string }> {
  try {
    const job = await exportDiffUseCase({ spaceKey, request });
    return view(spaceKey, job);
  } catch (error) {
    if (isAppError(error)) return { failed: error.message };
    throw error;
  }
}

export async function diffJobStatusAction(
  spaceKey: string,
  jobId: string,
): Promise<DiffJobView | { failed: string }> {
  try {
    return view(spaceKey, await jobStatusUseCase(spaceKey, jobId));
  } catch (error) {
    if (isAppError(error)) return { failed: error.message };
    throw error;
  }
}

function view(spaceKey: string, job: Awaited<ReturnType<typeof jobStatusUseCase>>): DiffJobView {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    message: job.message,
    error: job.error,
    downloadHref: job.state === 'DONE' && job.resultRef ? `/s/${spaceKey}/jobs/${job.id}/download` : null,
  };
}
