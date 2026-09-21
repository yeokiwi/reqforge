'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import {
  createTypeUseCase,
  deleteTypeUseCase,
  runValidationUseCase,
  updateTypeUseCase,
} from '@/server/usecases/requirement-types';
import { jobStatusUseCase } from '@/server/usecases/jobs';

export type TypeState = { message: string | null; error: string | null; jobId?: string | null };

/**
 * Rules and template columns are nested arrays, so they travel as JSON in one field —
 * the same shape the editor uses for ProseMirror content, and for the same reason.
 */
function read(formData: FormData) {
  const json = (name: string) => {
    const raw = formData.get(name);
    if (typeof raw !== 'string' || raw.trim().length === 0) return [];
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  };

  return {
    name: formData.get('name'),
    keyPattern: formData.get('keyPattern'),
    colour: formData.get('colour'),
    locked: formData.get('locked'),
    preventReusingDeletedKeys: formData.get('preventReusingDeletedKeys'),
    rules: json('rules'),
    templateColumns: json('templateColumns'),
  };
}

export async function createTypeAction(
  spaceKey: string,
  _previous: TypeState,
  formData: FormData,
): Promise<TypeState> {
  try {
    const created = await createTypeUseCase(spaceKey, read(formData));
    revalidatePath(`/s/${spaceKey}/admin/types`);
    return { message: `Created ${created.name ?? created.keyPattern}.`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function updateTypeAction(
  spaceKey: string,
  typeId: string,
  _previous: TypeState,
  formData: FormData,
): Promise<TypeState> {
  try {
    // spec 06 §2.2 trigger 2 — the edit revalidates the type through a job (RD-016).
    const { type, job } = await updateTypeUseCase(spaceKey, typeId, read(formData));
    revalidatePath(`/s/${spaceKey}/admin/types`);
    return {
      message: `Saved ${type.name ?? type.keyPattern}. Revalidating its requirements…`,
      error: null,
      jobId: job.id,
    };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function deleteTypeAction(
  spaceKey: string,
  typeId: string,
  _previous: TypeState,
  _formData: FormData,
): Promise<TypeState> {
  try {
    await deleteTypeUseCase(spaceKey, typeId);
    revalidatePath(`/s/${spaceKey}/admin/types`);
    return { message: 'Deleted. Its requirements keep their rows and lose their type.', error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

/** spec 06 §2.2 trigger 3 — "run validation" on demand, gated on EDIT (§5). */
export async function runValidationAction(
  spaceKey: string,
  typeId: string,
  _previous: TypeState,
  _formData: FormData,
): Promise<TypeState> {
  try {
    const job = await runValidationUseCase(spaceKey, typeId);
    revalidatePath(`/s/${spaceKey}/admin/types`);
    return { message: job.message ?? 'Validation queued.', error: null, jobId: job.id };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function validationJobStatusAction(
  spaceKey: string,
  jobId: string,
): Promise<{ state: string; progress: number; message: string | null } | { error: string }> {
  try {
    const job = await jobStatusUseCase(spaceKey, jobId);
    return { state: job.state, progress: job.progress, message: job.message };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
