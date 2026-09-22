'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import type { RenameRow } from '@/domain/keys/rename';
import {
  acknowledgeRenameUseCase,
  previewRenameUseCase,
  startRenameUseCase,
} from '@/server/usecases/rename';
import { cancelJobUseCase, jobStatusUseCase } from '@/server/usecases/jobs';

export type PreviewResponse =
  | { ok: true; rows: RenameRow[]; remainder: number; problems: number; runnable: number }
  | { ok: false; error: string };

export async function previewRenameAction(
  spaceKey: string,
  pairs: Array<{ from: string; to: string }>,
): Promise<PreviewResponse> {
  try {
    const preview = await previewRenameUseCase({ spaceKey, pairs });
    return {
      ok: true,
      rows: preview.rows,
      remainder: preview.remainder,
      problems: preview.problems,
      runnable: preview.runnable,
    };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

export async function startRenameAction(
  spaceKey: string,
  pairs: Array<{ from: string; to: string }>,
): Promise<{ jobId: string } | { error: string }> {
  try {
    const job = await startRenameUseCase({ spaceKey, pairs });
    revalidatePath(`/s/${spaceKey}`);
    return { jobId: job.id };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function renameJobStatusAction(
  spaceKey: string,
  jobId: string,
): Promise<{ state: string; progress: number; message: string | null; error: string | null } | { failed: string }> {
  try {
    const job = await jobStatusUseCase(spaceKey, jobId);
    return { state: job.state, progress: job.progress, message: job.message, error: job.error };
  } catch (error) {
    if (isAppError(error)) return { failed: error.message };
    throw error;
  }
}

export async function cancelRenameAction(spaceKey: string, jobId: string): Promise<{ failed: string } | void> {
  try {
    await cancelJobUseCase(spaceKey, jobId);
  } catch (error) {
    if (isAppError(error)) return { failed: error.message };
    throw error;
  }
}

export async function acknowledgeRenameAction(spaceKey: string, jobId: string): Promise<{ failed: string } | void> {
  try {
    await acknowledgeRenameUseCase(spaceKey, jobId);
    revalidatePath(`/s/${spaceKey}`);
  } catch (error) {
    if (isAppError(error)) return { failed: error.message };
    throw error;
  }
}
