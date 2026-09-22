'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import {
  createBaselineUseCase,
  deleteBaselineUseCase,
  freezeUseCase,
  previewUseCase,
  refreezeUseCase,
  type PreviewFailure,
  type PreviewSuccess,
} from '@/server/usecases/baselines';
import { cancelJobUseCase, jobStatusUseCase } from '@/server/usecases/jobs';

export type BaselineState = { message: string | null; error: string | null; jobId?: string | null };

export type PreviewResponse = PreviewSuccess | PreviewFailure | { ok: false; refused: string };

/** The live draft preview: members are computed from the query until the freeze. */
export async function previewAction(
  spaceKey: string,
  query: string,
  includeParentDependencies: boolean,
): Promise<PreviewResponse> {
  try {
    return await previewUseCase({ spaceKey, query, includeParentDependencies });
  } catch (error) {
    if (isAppError(error)) return { ok: false, refused: error.message };
    throw error;
  }
}

export async function createBaselineAction(
  spaceKey: string,
  _previous: BaselineState,
  formData: FormData,
): Promise<BaselineState> {
  try {
    const baseline = await createBaselineUseCase({
      spaceKey,
      name: formData.get('name'),
      query: formData.get('query'),
      includeParentDependencies: formData.get('includeParentDependencies') === 'on',
      includedExternal: formData.get('includedExternal') === 'on',
      withReportDocument: formData.get('withReportDocument') === 'on',
    });
    revalidatePath(`/s/${spaceKey}/baselines`);
    return { message: `Created baseline ${baseline.number} — ${baseline.name}.`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function freezeAction(
  spaceKey: string,
  id: string,
  _previous: BaselineState,
  _formData: FormData,
): Promise<BaselineState> {
  try {
    const job = await freezeUseCase({ spaceKey, id });
    revalidatePath(`/s/${spaceKey}/baselines`);
    return { message: job.message ?? 'Freezing…', error: null, jobId: job.id };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

/** spec 05 §3.4 — a refreeze needs a reason; it is the part an auditor reads. */
export async function refreezeAction(
  spaceKey: string,
  id: string,
  _previous: BaselineState,
  formData: FormData,
): Promise<BaselineState> {
  try {
    const job = await refreezeUseCase({ spaceKey, id, reason: formData.get('reason') });
    revalidatePath(`/s/${spaceKey}/baselines`);
    return { message: job.message ?? 'Revising…', error: null, jobId: job.id };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function deleteBaselineAction(
  spaceKey: string,
  id: string,
  _previous: BaselineState,
  _formData: FormData,
): Promise<BaselineState> {
  try {
    await deleteBaselineUseCase(spaceKey, id);
    revalidatePath(`/s/${spaceKey}/baselines`);
    return { message: 'Deleted. Its number is not reissued (invariant B2).', error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function baselineJobStatusAction(
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

/** spec 05 §3.2 — a freeze runs as a job with progress and cancel. */
export async function cancelBaselineJobAction(spaceKey: string, jobId: string): Promise<{ failed: string } | void> {
  try {
    await cancelJobUseCase(spaceKey, jobId);
  } catch (error) {
    if (isAppError(error)) return { failed: error.message };
    throw error;
  }
}
