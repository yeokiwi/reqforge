'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import type { MatrixConfig } from '@/domain/traceability/matrix';
import {
  deleteMatrixUseCase,
  runMatrixUseCase,
  saveMatrixUseCase,
  type MatrixFailure,
  type MatrixSuccess,
} from '@/server/usecases/matrix';
import { cancelJobUseCase, exportMatrixUseCase, jobStatusUseCase } from '@/server/usecases/jobs';
import { setValueInBulkUseCase, setValueUseCase } from '@/server/usecases/external-properties';

export type MatrixResponse = MatrixSuccess | MatrixFailure;

export async function runMatrixAction(
  spaceKey: string,
  config: MatrixConfig,
  offset: number,
  documentId?: string | null,
): Promise<MatrixResponse> {
  return runMatrixUseCase({ spaceKey, config, offset, documentId: documentId ?? null });
}

export type SaveMatrixState = { message: string | null; error: string | null };

export async function saveMatrixAction(
  spaceKey: string,
  config: MatrixConfig,
  _previous: SaveMatrixState,
  formData: FormData,
): Promise<SaveMatrixState> {
  try {
    const saved = await saveMatrixUseCase({
      spaceKey,
      name: formData.get('name'),
      config,
      visibility: String(formData.get('visibility') ?? 'space'),
    });
    revalidatePath(`/s/${spaceKey}/traceability`);
    return { message: `Saved "${saved.name}".`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function deleteMatrixAction(spaceKey: string, formData: FormData): Promise<void> {
  await deleteMatrixUseCase(spaceKey, String(formData.get('id') ?? ''));
  revalidatePath(`/s/${spaceKey}/traceability`);
}

export type JobView = {
  id: string;
  state: string;
  progress: number;
  message: string | null;
  error: string | null;
  downloadHref: string | null;
};

function toView(spaceKey: string, job: Awaited<ReturnType<typeof jobStatusUseCase>>): JobView {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    message: job.message,
    error: job.error,
    downloadHref: job.state === 'DONE' && job.resultRef ? `/s/${spaceKey}/jobs/${job.id}/download` : null,
  };
}

export async function exportMatrixAction(
  spaceKey: string,
  name: string,
  config: MatrixConfig,
): Promise<JobView | { error: string }> {
  try {
    const job = await exportMatrixUseCase({ spaceKey, name, config });
    return toView(spaceKey, job);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function jobStatusAction(spaceKey: string, jobId: string): Promise<JobView | { error: string }> {
  try {
    return toView(spaceKey, await jobStatusUseCase(spaceKey, jobId));
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function cancelJobAction(spaceKey: string, jobId: string): Promise<void> {
  await cancelJobUseCase(spaceKey, jobId);
}

export type ValueState = { value: string | null; error: string | null };

/** spec 04 §2.2 — editing an external value in place, one cell at a time. */
export async function setExternalValueAction(
  spaceKey: string,
  requirementId: string,
  definitionId: string,
  value: string,
): Promise<ValueState> {
  try {
    const outcome = await setValueUseCase({ spaceKey, requirementId, definitionId, value });
    return { value: outcome.value, error: null };
  } catch (error) {
    if (isAppError(error)) return { value: null, error: error.message };
    throw error;
  }
}

export type BulkState = { message: string | null; error: string | null };

/**
 * "Set value in bulk" across the whole result set, not the visible page (spec 04 §2.2).
 * The permission check lives in the usecase (RD-039).
 */
export async function setExternalValueInBulkAction(
  spaceKey: string,
  query: string,
  definitionId: string,
  value: string,
): Promise<BulkState> {
  try {
    const outcome = await setValueInBulkUseCase({ spaceKey, query, definitionId, value });
    const what = outcome.value === null ? 'Cleared' : `Set to "${outcome.value}" on`;
    return {
      message: `${what} ${outcome.written} of ${outcome.population} matching requirement${
        outcome.population === 1 ? '' : 's'
      }.`,
      error: null,
    };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}
