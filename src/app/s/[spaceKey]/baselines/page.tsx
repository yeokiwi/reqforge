import Link from 'next/link';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { listBaselinesUseCase } from '@/server/usecases/baselines';
import { CreateBaselineForm, DeleteBaselineForm, FreezeForm } from './baseline-forms';

/**
 * Baselines.
 * spec: 05-baselines-and-diff.md §1–4 — "a named, numbered, immutable snapshot of a set
 * of requirements at a point in time … the artefact you attach to a contract, a design
 * review or a certification package". Managing them needs ADMIN (spec 07 §2.1).
 */
export default async function BaselinesPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { can } = await requireSpace(spaceKey);
  const baselines = await listBaselinesUseCase(spaceKey);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Baselines</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          A draft holds no rows: its members are worked out from its query every time you look, so the scope can
          move while you agree it. Freezing materialises them, and from then on they cannot change — the database
          refuses, not just the application.
        </p>
      </div>

      {can('ADMIN') ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
            Create a draft
          </h2>
          <CreateBaselineForm spaceKey={spaceKey} />
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          {baselines.length} {baselines.length === 1 ? 'baseline' : 'baselines'}
        </h2>
        <ul className="flex flex-col gap-3" data-testid="baseline-list">
          {baselines.map((baseline) => (
            <li key={baseline.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--rf-line)] pt-3">
              <Link
                href={`/s/${spaceKey}/baselines/${baseline.number}`}
                className="rounded bg-[var(--rf-bg)] px-2 py-0.5 font-mono text-xs text-[var(--rf-accent)]"
              >
                #{baseline.number}
              </Link>
              <span className="text-sm font-medium">{baseline.name}</span>
              <span
                data-testid={`state-${baseline.number}`}
                className={`rounded px-2 py-0.5 text-xs ${
                  baseline.state === 'FROZEN' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {baseline.state}
              </span>
              <span className="font-mono text-xs text-[var(--rf-muted)]">{baseline.sourceQuery}</span>
              <span className="text-xs text-[var(--rf-muted)]">
                {baseline.state === 'FROZEN'
                  ? `${baseline.memberCount} members, frozen ${baseline.frozenAt?.toISOString().slice(0, 10) ?? ''}`
                  : 'no rows yet'}
              </span>
              <span className="flex-1" />
              {can('ADMIN') && baseline.state === 'DRAFT' ? (
                <FreezeForm spaceKey={spaceKey} id={baseline.id} />
              ) : null}
              {can('ADMIN') ? <DeleteBaselineForm spaceKey={spaceKey} id={baseline.id} /> : null}
            </li>
          ))}
          {baselines.length === 0 ? <li className="text-sm text-[var(--rf-muted)]">None yet.</li> : null}
        </ul>
      </Panel>
    </main>
  );
}
