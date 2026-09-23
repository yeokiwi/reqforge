'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import { unlockDocumentUseCase } from '@/server/usecases/restrictions';

/** RD-058 — an administrator removes a restriction without reading what it protected. */
export async function unlockDocumentAction(spaceKey: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const documentId = formData.get('documentId');
    await unlockDocumentUseCase(spaceKey, typeof documentId === 'string' ? documentId : '');
    revalidatePath(`/s/${spaceKey}/admin/restrictions`);
    return 'Restriction removed.';
  });
}
