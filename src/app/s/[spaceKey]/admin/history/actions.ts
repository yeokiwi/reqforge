'use server';

import { revalidatePath } from 'next/cache';
import { isAppError, ValidationError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { prisma } from '@/server/repositories/client';
import { pruneHistory } from '@/server/repositories/history';

export type HistorySettingsState = { message: string | null; error: string | null };

/** spec 05 §6; 07 §2.1 — history settings are a space administrator's. */
export async function saveHistorySettingsAction(
  spaceKey: string,
  _previous: HistorySettingsState,
  formData: FormData,
): Promise<HistorySettingsState> {
  try {
    const { space } = await requireSpace(spaceKey, 'ADMIN');

    const raw = formData.get('retentionDays');
    const days = typeof raw === 'string' && raw.trim().length > 0 ? Number(raw) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1)) {
      throw new ValidationError('Retention is a whole number of days, or blank to keep history for ever.');
    }

    await prisma.space.update({
      where: { id: space.id },
      data: { historyEnabled: formData.get('historyEnabled') === 'on', historyRetentionDays: days },
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
    const { space } = await requireSpace(spaceKey, 'ADMIN');
    if (!space.historyRetentionDays) {
      throw new ValidationError('Set a retention period first; without one, history is kept for ever.');
    }

    const outcome = await pruneHistory(space.id, space.historyRetentionDays);
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
