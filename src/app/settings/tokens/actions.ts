'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import { createMyTokenUseCase, revokeMyTokenUseCase } from '@/server/usecases/api-tokens';

export type CreateTokenState = FormState & { token: string | null };

/** RD-065 — the plaintext is returned to this one response and never again. */
export async function createTokenAction(_previous: CreateTokenState, formData: FormData): Promise<CreateTokenState> {
  let token: string | null = null;
  const outcome = await runAction(async () => {
    const created = await createMyTokenUseCase({
      name: formData.get('name'),
      scopes: formData.getAll('scopes'),
      spaceKeys: String(formData.get('spaceKeys') ?? '')
        .split(',')
        .map((key) => key.trim().toUpperCase())
        .filter(Boolean),
    });
    token = created.token;
    revalidatePath('/settings/tokens');
    return 'Created. Copy it now — it will not be shown again.';
  });
  return { ...outcome, token };
}

export async function revokeTokenAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await revokeMyTokenUseCase(String(formData.get('id') ?? ''));
    revalidatePath('/settings/tokens');
    return 'Revoked.';
  });
}
