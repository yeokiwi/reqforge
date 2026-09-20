'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import { resetKeySequenceUseCase, suggestNextKeyUseCase, type KeySuggestion } from '@/server/usecases/keys';

export type ResetState = { message: string | null; error: string | null };

export async function resetSequenceAction(
  spaceKey: string,
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  try {
    const typeId = String(formData.get('typeId') ?? '');
    const next = await resetKeySequenceUseCase(spaceKey, typeId);
    revalidatePath(`/s/${spaceKey}/admin/keys`);
    return { message: `Next number is now ${next}.`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

/** Used by the editor's "Suggest" button. */
export async function suggestKeyAction(
  spaceKey: string,
  documentId: string | null,
): Promise<KeySuggestion | { error: string }> {
  try {
    return await suggestNextKeyUseCase({ spaceKey, documentId });
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
