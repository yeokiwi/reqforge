'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAppError, ValidationError } from '@/domain/errors';
import {
  createDocumentUseCase,
  deleteDocumentUseCase,
  moveDocumentUseCase,
  renameDocumentUseCase,
  saveDocumentUseCase,
} from '@/server/usecases/documents';

export type ActionState = { error: string | null };

function message(error: unknown): string {
  if (isAppError(error)) return error.message;
  throw error;
}

export async function createDocumentAction(
  spaceKey: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let documentId: string;
  try {
    const parentRaw = formData.get('parentId');
    const document = await createDocumentUseCase({
      spaceKey,
      title: formData.get('title'),
      parentId: typeof parentRaw === 'string' && parentRaw.length > 0 ? parentRaw : null,
    });
    documentId = document.id;
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath(`/s/${spaceKey}/documents`);
  redirect(`/s/${spaceKey}/documents/${documentId}`);
}

export async function saveDocumentAction(
  spaceKey: string,
  documentId: string,
  contentJson: string,
): Promise<Awaited<ReturnType<typeof saveDocumentUseCase>> | { error: string }> {
  try {
    const content: unknown = JSON.parse(contentJson);
    const result = await saveDocumentUseCase({ spaceKey, documentId, content });
    revalidatePath(`/s/${spaceKey}/documents/${documentId}`);
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { error: new ValidationError('The editor sent a document body that is not valid JSON.').message };
    }
    return { error: message(error) };
  }
}

export async function renameDocumentAction(spaceKey: string, formData: FormData): Promise<void> {
  const documentId = String(formData.get('documentId') ?? '');
  await renameDocumentUseCase(spaceKey, documentId, formData.get('title'));
  revalidatePath(`/s/${spaceKey}/documents`);
  revalidatePath(`/s/${spaceKey}/documents/${documentId}`);
}

export async function moveDocumentAction(spaceKey: string, formData: FormData): Promise<void> {
  const documentId = String(formData.get('documentId') ?? '');
  const parentRaw = formData.get('parentId');
  const parentId = typeof parentRaw === 'string' && parentRaw.length > 0 ? parentRaw : null;
  await moveDocumentUseCase(spaceKey, documentId, parentId);
  revalidatePath(`/s/${spaceKey}/documents`);
}

export async function deleteDocumentAction(spaceKey: string, formData: FormData): Promise<void> {
  await deleteDocumentUseCase(spaceKey, String(formData.get('documentId') ?? ''));
  revalidatePath(`/s/${spaceKey}/documents`);
  redirect(`/s/${spaceKey}/documents`);
}
