'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { verifyPassword } from '@/server/auth/password';
import { endSession, startSession } from '@/server/auth/session';
import { findUserByEmail } from '@/server/repositories/users';

const credentials = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginState = { error: string | null };

export async function signInAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' };
  }

  const user = await findUserByEmail(parsed.data.email);
  // Same message either way: an unknown address and a wrong password are indistinguishable.
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return { error: 'Those credentials do not match an account.' };
  }

  await startSession(user.id);
  redirect('/spaces');
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}
