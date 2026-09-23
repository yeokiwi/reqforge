'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import { createWebhookUseCase, deleteWebhookUseCase, redeliverUseCase } from '@/server/usecases/webhooks';

export type CreateHookState = FormState & { secret: string | null };

/** spec 08 §7 — the signing secret is shown to this response only. */
export async function createHookAction(spaceKey: string, _previous: CreateHookState, formData: FormData): Promise<CreateHookState> {
  let secret: string | null = null;
  const outcome = await runAction(async () => {
    const created = await createWebhookUseCase(spaceKey, { url: formData.get('url'), events: formData.getAll('events') });
    secret = created.secret;
    revalidatePath(`/s/${spaceKey}/admin/webhooks`);
    return 'Subscribed. Copy the signing secret now — it will not be shown again.';
  });
  return { ...outcome, secret };
}

export async function deleteHookAction(spaceKey: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await deleteWebhookUseCase(spaceKey, String(formData.get('id') ?? ''));
    revalidatePath(`/s/${spaceKey}/admin/webhooks`);
    return 'Removed.';
  });
}

export async function redeliverAction(spaceKey: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await redeliverUseCase(spaceKey, String(formData.get('id') ?? ''));
    revalidatePath(`/s/${spaceKey}/admin/webhooks`);
    return 'Queued again.';
  });
}
