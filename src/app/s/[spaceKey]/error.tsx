'use client';

import Link from 'next/link';

export default function SpaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-16">
      <h1 className="text-lg font-semibold">That did not work</h1>
      <p className="text-sm text-[var(--rf-muted)]">{error.message}</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded bg-[var(--rf-bg)] px-3 py-1.5 text-sm">
          Try again
        </button>
        <Link href="/spaces" className="text-sm text-[var(--rf-accent)]">
          Back to spaces
        </Link>
      </div>
    </main>
  );
}
