import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (await currentUser()) redirect('/spaces');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reqforge</h1>
        <p className="text-sm text-[var(--rf-muted)]">Sign in to your spaces.</p>
      </div>
      <div className="rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-6">
        <LoginForm />
      </div>
    </main>
  );
}
