'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import { LIMIT_IDS } from '@/domain/limits';
import { setSpaceLimitsUseCase } from '@/server/usecases/limits';

/**
 * A blank field means "no override". Anything typed is passed through as a number, and the
 * use case refuses what the override class does not allow (RD-071).
 */
export async function saveSpaceLimitsAction(spaceKey: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const overrides: Record<string, number> = {};
    for (const id of LIMIT_IDS) {
      const raw = formData.get(id);
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      overrides[id] = Number(raw.trim());
    }
    await setSpaceLimitsUseCase(spaceKey, overrides);
    revalidatePath('/admin/limits');
    const count = Object.keys(overrides).length;
    return count === 0 ? `${spaceKey} now uses the installation limits.` : `Saved ${count} override${count === 1 ? '' : 's'} for ${spaceKey}.`;
  });
}
