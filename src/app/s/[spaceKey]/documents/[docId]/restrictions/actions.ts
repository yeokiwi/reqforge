'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import { labelDocumentUseCase } from '@/server/usecases/documents';
import { setDocumentRestrictionUseCase } from '@/server/usecases/restrictions';

/** spec 07 §2.2; RD-057. The grants arrive as JSON from the restriction editor. */
export async function saveRestrictionAction(
  spaceKey: string,
  documentId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const raw = formData.get('grants');
    const grants: unknown = typeof raw === 'string' && raw.length > 0 ? JSON.parse(raw) : [];
    await setDocumentRestrictionUseCase({ spaceKey, documentId, mode: formData.get('mode'), grants });
    revalidatePath(`/s/${spaceKey}/documents/${documentId}`);
    return 'Saved.';
  });
}

/** spec 07 §2.3; RD-060 — labelling a document is part of editing it. */
export async function saveDocumentLabelAction(
  spaceKey: string,
  documentId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const levelId = formData.get('levelId');
    await labelDocumentUseCase(spaceKey, documentId, typeof levelId === 'string' && levelId.length > 0 ? levelId : null);
    revalidatePath(`/s/${spaceKey}/documents/${documentId}`);
    return 'Saved.';
  });
}
