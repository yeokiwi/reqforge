import Link from 'next/link';
import { signOutAction } from '@/app/(auth)/login/actions';

export function TopBar({ userName, children }: { userName: string; children?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-4 border-b border-[var(--rf-line)] bg-[var(--rf-panel)] px-6 py-3">
      <Link href="/spaces" className="text-sm font-semibold tracking-tight">
        Reqforge
      </Link>
      <div className="flex-1">{children}</div>
      <span className="text-sm text-[var(--rf-muted)]">{userName}</span>
      {/* spec 08 §1 — a person's own API tokens. */}
      <Link href="/settings/tokens" className="text-sm text-[var(--rf-muted)] hover:text-[var(--rf-ink)]">
        API tokens
      </Link>
      <form action={signOutAction}>
        <button type="submit" className="text-sm text-[var(--rf-accent)] hover:underline">
          Sign out
        </button>
      </form>
    </header>
  );
}

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-5 ${className}`}>
      {children}
    </section>
  );
}
