import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel } from '@/app/_components/chrome';
import { NotFoundError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { prisma } from '@/server/repositories/client';
import { baselineDetailUseCase } from '@/server/usecases/baselines';
import { RefreezeForm } from '../baseline-forms';

/** spec: 05-baselines-and-diff.md §3.3 (what the summary states) and §3.4 (revisions). */
export default async function BaselinePage({
  params,
}: {
  params: Promise<{ spaceKey: string; number: string }>;
}) {
  const { spaceKey, number } = await params;
  const { can } = await requireSpace(spaceKey);

  let detail;
  try {
    detail = await baselineDetailUseCase(spaceKey, Number(number));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { baseline, memberCount, dangling, revisions, reportDocumentId } = detail;
  const members = await prisma.requirement.findMany({
    where: { baselineId: baseline.id },
    orderBy: { upperKey: 'asc' },
    take: 600,
    select: { id: true, key: true, title: true, status: true },
  });

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-[var(--rf-bg)] px-2 py-0.5 font-mono text-xs">#{baseline.number}</span>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">{baseline.name}</h1>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            baseline.state === 'FROZEN' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {baseline.state}
        </span>
        {revisions.length > 0 ? (
          // spec 05 §3.4 — "a refrozen baseline is visibly marked as revised".
          <span data-testid="revised" className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            revised {revisions.length}×
          </span>
        ) : null}
        <Link href={`/s/${spaceKey}/baselines`} className="text-sm text-[var(--rf-accent)]">
          All baselines
        </Link>
      </div>

      <Panel>
        <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--rf-muted)]">Query</dt>
          <dd className="font-mono text-xs">{baseline.sourceQuery}</dd>
          <dt className="text-[var(--rf-muted)]">Members</dt>
          <dd data-testid="member-count">{memberCount}</dd>
          <dt className="text-[var(--rf-muted)]">Frozen</dt>
          <dd>{baseline.frozenAt ? baseline.frozenAt.toISOString() : 'not yet'}</dd>
          <dt className="text-[var(--rf-muted)]">External properties</dt>
          <dd>{baseline.includedExternal ? 'frozen with it (RD-010)' : 'not frozen'}</dd>
          <dt className="text-[var(--rf-muted)]">Dependencies outside</dt>
          {/* spec 05 §3.3 — the freeze summary states how many point outside. */}
          <dd data-testid="dangling-count">{dangling.length}</dd>
          {reportDocumentId ? (
            <>
              <dt className="text-[var(--rf-muted)]">Report</dt>
              <dd>
                <Link href={`/s/${spaceKey}/documents/${reportDocumentId}`} className="text-[var(--rf-accent)]">
                  Open the report document
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
      </Panel>

      {can('ADMIN') && baseline.state === 'FROZEN' ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Refreeze</h2>
          <p className="mb-2 text-xs text-[var(--rf-muted)]">
            Re-runs the query and replaces the members. The reason is recorded permanently and cannot be erased.
          </p>
          <RefreezeForm spaceKey={spaceKey} id={baseline.id} />
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Members</h2>
        <table className="w-full text-sm" data-testid="baseline-members">
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-t border-[var(--rf-line)]">
                <td className="w-32 py-1.5">
                  <Link href={`/s/${spaceKey}/r/${encodeURIComponent(member.key)}`} className="rf-req">
                    {member.key}
                  </Link>
                </td>
                <td className="py-1.5">{member.title}</td>
                <td className="w-24 py-1.5 text-xs text-[var(--rf-muted)]">{member.status}</td>
              </tr>
            ))}
            {members.length === 0 ? (
              <tr>
                <td className="py-3 text-[var(--rf-muted)]">
                  Nothing frozen yet. A draft owns no rows until it is frozen (invariant B1).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>

      {dangling.length > 0 ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
            Dependencies pointing outside
          </h2>
          <p className="mb-2 text-xs text-[var(--rf-muted)]">
            Recorded rather than dropped, so a diff can explain them. Their targets keep changing (spec 05 §3.3).
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {dangling.slice(0, 100).map((edge) => (
              <li key={edge.id} className="font-mono text-xs">
                {edge.childKey} —{edge.relationship}→ {edge.targetKey}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {revisions.length > 0 ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Revisions</h2>
          <ul className="flex flex-col gap-2 text-sm" data-testid="revisions">
            {revisions.map((revision) => (
              <li key={revision.id} className="border-t border-[var(--rf-line)] pt-2">
                <p className="text-xs text-[var(--rf-muted)]">
                  {revision.at.toISOString()} — {revision.countBefore} → {revision.countAfter} members
                </p>
                <p>{revision.reason}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </main>
  );
}
