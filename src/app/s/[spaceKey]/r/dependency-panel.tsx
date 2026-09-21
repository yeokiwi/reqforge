import Link from 'next/link';
import { groupDependencies, queryForGroup, type DependencyEdge } from '@/domain/traceability/dependencies';

/**
 * Dependencies in both directions, grouped by relationship.
 * spec: 04-traceability-and-coverage.md §1; invariant P1 for the direction vocabulary.
 */
export function DependencyPanel({
  spaceKey,
  requirementKey,
  edges,
}: {
  spaceKey: string;
  requirementKey: string;
  edges: DependencyEdge[];
}) {
  if (edges.length === 0) {
    return <p className="text-sm text-[var(--rf-muted)]">No dependencies.</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="dependencies">
      {groupDependencies(edges).map((group) => (
        <div key={`${group.direction}-${group.relationship}`}>
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">{group.label}</h3>
            <Link
              href={`/s/${spaceKey}/search?q=${encodeURIComponent(queryForGroup(group, requirementKey))}`}
              className="text-xs text-[var(--rf-accent)]"
            >
              {group.edges.length} — search
            </Link>
          </div>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {group.edges.map((edge) => (
              <li key={`${edge.direction}-${edge.relationship}-${edge.otherSpaceKey ?? ''}${edge.otherKey}`}>
                {edge.unresolved ? (
                  <span className="rf-req-link" title="This target does not resolve (invariant P2)">
                    {edge.otherSpaceKey ? `${edge.otherSpaceKey}/` : ''}
                    {edge.otherKey}
                  </span>
                ) : (
                  <Link
                    href={`/s/${edge.otherSpaceKey ?? spaceKey}/r/${encodeURIComponent(edge.otherKey)}`}
                    className="rf-req"
                  >
                    {edge.otherSpaceKey ? `${edge.otherSpaceKey}/` : ''}
                    {edge.otherKey}
                  </Link>
                )}{' '}
                <span className="text-[var(--rf-muted)]">{edge.otherTitle}</span>
                {edge.baselineNumber !== null ? (
                  <span className="ml-1 text-xs text-[var(--rf-muted)]">pinned to baseline {edge.baselineNumber}</span>
                ) : null}
                {edge.unresolved ? <span className="ml-1 text-xs text-red-600">unresolved</span> : null}
                {!edge.unresolved && edge.otherStatus !== 'ACTIVE' ? (
                  <span className="ml-1 text-xs text-amber-700">{edge.otherStatus}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
