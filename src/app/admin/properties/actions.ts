'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import {
  createDefinitionUseCase,
  deleteDefinitionUseCase,
  updateDefinitionUseCase,
} from '@/server/usecases/external-properties';

export type DefinitionState = { message: string | null; error: string | null };

function read(formData: FormData) {
  return {
    name: formData.get('name'),
    dataType: formData.get('dataType'),
    enumValues: formData.get('enumValues'),
    description: formData.get('description'),
  };
}

export async function createDefinitionAction(
  _previous: DefinitionState,
  formData: FormData,
): Promise<DefinitionState> {
  try {
    const created = await createDefinitionUseCase(read(formData));
    revalidatePath('/admin/properties');
    return { message: `Defined "${created.name}".`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function updateDefinitionAction(
  id: string,
  _previous: DefinitionState,
  formData: FormData,
): Promise<DefinitionState> {
  try {
    const updated = await updateDefinitionUseCase(id, read(formData));
    revalidatePath('/admin/properties');
    return { message: `Saved "${updated.name}".`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function deleteDefinitionAction(
  id: string,
  _previous: DefinitionState,
  _formData: FormData,
): Promise<DefinitionState> {
  try {
    await deleteDefinitionUseCase(id);
    revalidatePath('/admin/properties');
    return { message: 'Deleted.', error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}
