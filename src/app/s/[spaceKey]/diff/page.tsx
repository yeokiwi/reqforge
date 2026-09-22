import { requireSpace } from '@/server/authz';
import { DiffClient } from './diff-client';

/**
 * spec: 05-baselines-and-diff.md §5.1 — the diff is driven by **two queries**. A baseline
 * page links in here with them pre-filled, which is all "select two baselines" ever was
 * (research §5.5).
 */
export default async function DiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const { spaceKey } = await params;
  const { left, right } = await searchParams;
  const { can } = await requireSpace(spaceKey);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Diff</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Two queries, compared by key. A baseline on the left and the live requirements on the right answers
          &ldquo;what changed since we agreed this?&rdquo; — but any two queries work, so comparing a subset is
          free.
        </p>
      </div>

      <DiffClient
        spaceKey={spaceKey}
        canExport={can('EXPORT')}
        initialLeft={left ?? ''}
        initialRight={right ?? ''}
      />
    </main>
  );
}
