'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import { pruneHistoryUseCase, saveHistorySettingsUseCase } from '@/server/usecases/history';

export type HistorySettingsState = { message: string | null; error: string | null };

/** spec 05 §6; 07 §2.1 — history settings are a space administrator's. */
export async function saveHistorySettingsAction(
  spaceKey: string,
  _previous: HistorySettingsState,
  formData: FormData,
): Promise<HistorySettingsState> {
  try {
    await saveHistorySettingsUseCase(spaceKey, {
      enabled: formData.get('historyEnabled') === 'on',
      retentionDays: formData.get('retentionDays'),
    });

    revalidatePath(`/s/${spaceKey}/admin/history`);
    return { message: 'Saved.', error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

/** Runs retention now. `RD-049` decides what it may not touch. */
export async function pruneHistoryAction(
  spaceKey: string,
  _previous: HistorySettingsState,
  _formData: FormData,
): Promise<HistorySettingsState> {
  try {
    const outcome = await pruneHistoryUseCase(spaceKey);
    revalidatePath(`/s/${spaceKey}/admin/history`);
    return {
      message:
        `Removed ${outcome.removed} row${outcome.removed === 1 ? '' : 's'}. ` +
        `${outcome.protectedByBaseline} were kept because a frozen baseline depends on them.`,
      error: null,
    };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}
