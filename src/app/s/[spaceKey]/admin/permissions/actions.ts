'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import { setSpaceLabelUseCase } from '@/server/usecases/classification';
import { setPermissionsUseCase } from '@/server/usecases/permissions';

/** spec 07 §2.1; RD-061 — sets a subject's permissions exactly; none revokes them. */
export async function setPermissionsAction(spaceKey: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const permissions = formData.getAll('permissions').filter((value): value is string => typeof value === 'string');
    const granted = await setPermissionsUseCase(spaceKey, {
      email: formData.get('email'),
      group: formData.get('group'),
      permissions,
    });
    revalidatePath(`/s/${spaceKey}/admin/permissions`);
    return granted.length === 0 ? 'Removed from the space.' : `Now holds ${granted.join(', ')}.`;
  });
}

/** spec 07 §2.3; RD-060. */
export async function setSpaceLabelAction(spaceKey: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const levelId = formData.get('levelId');
    await setSpaceLabelUseCase(spaceKey, typeof levelId === 'string' && levelId.length > 0 ? levelId : null);
    revalidatePath(`/s/${spaceKey}`);
    return 'Saved.';
  });
}
