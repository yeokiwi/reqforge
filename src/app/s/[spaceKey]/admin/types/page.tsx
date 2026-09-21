import Link from 'next/link';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { listTypesUseCase } from '@/server/usecases/requirement-types';
import { TypeActions, TypeForm } from './type-form';

/**
 * Requirement types: patterns, rules, templates and their validation summary.
 * spec: 06-requirement-types.md — §1 (one entity), §2 (validation and its triggers),
 * §3 (templates), §5 (view reads, edit runs validation, admin changes types).
 */
export default async function TypesAdminPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { can } = await requireSpace(spaceKey);
  const types = await listTypesUseCase(spaceKey);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Requirement types</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          A type is a key pattern with rules. Editing one revalidates every requirement it covers, through a job
          with progress — the trigger Requirement Yogi cannot offer (spec 06 §2.2).{' '}
          <Link href={`/s/${spaceKey}/admin/keys`} className="text-[var(--rf-accent)]">
            Key sequences
          </Link>{' '}
          are the same types, seen from the other side.
        </p>
      </div>

      {can('ADMIN') ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Add a type</h2>
          <TypeForm spaceKey={spaceKey} canAdmin />
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          {types.length} {types.length === 1 ? 'type' : 'types'}
        </h2>
        <ul className="flex flex-col gap-5" data-testid="type-list">
          {types.map((type) => (
            <li key={type.id} className="flex flex-col gap-2 border-t border-[var(--rf-line)] pt-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--rf-muted)]">
                <span
                  className="rounded px-2 py-0.5 font-mono"
                  style={{ background: `${type.colour}1a`, color: type.colour }}
                >
                  {type.keyPattern}
                </span>
                <span>{type.requirementCount} requirements</span>
                {/* spec 06 §2.1 — the same red/yellow/green the editor uses. */}
                <span data-testid={`counts-${type.id}`} className="flex items-center gap-2">
                  <span className="text-emerald-700">{type.counts.TRUE} passing</span>
                  <span className="text-red-600">{type.counts.FALSE} failing</span>
                  <span className="text-amber-700">{type.counts.WARNING} with warnings</span>
                </span>
                <span className="flex-1" />
                <TypeActions spaceKey={spaceKey} type={type} canAdmin={can('ADMIN')} canEdit={can('EDIT')} />
              </div>
              <TypeForm spaceKey={spaceKey} type={type} canAdmin={can('ADMIN')} />
            </li>
          ))}
          {types.length === 0 ? (
            <li className="text-sm text-[var(--rf-muted)]">No types configured.</li>
          ) : null}
        </ul>
      </Panel>
    </main>
  );
}
