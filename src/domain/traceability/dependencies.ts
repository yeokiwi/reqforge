/**
 * Pure shaping of dependency edges for display.
 * spec: 01-domain-model.md (invariant P1), 02-query-language.md §4, research §4.1.
 *
 * Direction vocabulary, fixed once here so the requirement page, the popup, the broken
 * links screen and the matrix of slice 8 cannot drift apart:
 *   - `to` / `parent`: this requirement → the requirements it depends on (its parents).
 *   - `from` / `child`: the requirements that depend on this one (its children).
 */
export type DependencyDirection = 'to' | 'from';

export const DIRECTION_LABELS: Readonly<Record<DependencyDirection, string>> = {
  to: 'Depends on',
  from: 'Depended on by',
};

/** The RQL field that reproduces a given edge as a query (used for clickable figures). */
export const DIRECTION_FIELDS: Readonly<Record<DependencyDirection, string>> = {
  to: 'to',
  from: 'from',
};

export type DependencyEdge = {
  direction: DependencyDirection;
  relationship: string;
  /** The requirement at the other end. */
  otherKey: string;
  otherTitle: string;
  otherSpaceKey: string | null;
  otherStatus: string;
  /** A link pinned to a baseline of the target (research §4.1). */
  baselineNumber: number | null;
  /** True when the edge is recorded but its target does not resolve (invariant P2). */
  unresolved: boolean;
  /**
   * Rule X2 — the other end exists but this reader may not see it: "the existence of a
   * link is not itself secret, its target's content is". The key stays; title and status
   * do not, and nothing links to it (RD-064).
   */
  restricted?: boolean;
};

export type DependencyGroup = {
  direction: DependencyDirection;
  relationship: string;
  label: string;
  edges: DependencyEdge[];
};

/**
 * Groups edges by direction and relationship, in a stable order: outbound before inbound,
 * relationships alphabetically, targets by key.
 */
export function groupDependencies(edges: readonly DependencyEdge[]): DependencyGroup[] {
  const groups = new Map<string, DependencyGroup>();

  for (const edge of edges) {
    const id = `${edge.direction}:${edge.relationship}`;
    const group = groups.get(id) ?? {
      direction: edge.direction,
      relationship: edge.relationship,
      label: `${DIRECTION_LABELS[edge.direction]} — ${edge.relationship}`,
      edges: [],
    };
    group.edges.push(edge);
    groups.set(id, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, edges: [...group.edges].sort(byKey) }))
    .sort(
      (a, b) =>
        directionRank(a.direction) - directionRank(b.direction) ||
        a.relationship.localeCompare(b.relationship),
    );
}

function directionRank(direction: DependencyDirection): number {
  return direction === 'to' ? 0 : 1;
}

function byKey(a: DependencyEdge, b: DependencyEdge): number {
  return a.otherKey.localeCompare(b.otherKey);
}

/** The RQL query that finds everything on the far side of this group. */
export function queryForGroup(group: DependencyGroup, key: string): string {
  const field = DIRECTION_FIELDS[group.direction];
  const relationship = group.relationship.includes(' ')
    ? `@'${group.relationship}'`
    : `@${group.relationship}`;
  return `${field}${relationship} = '${key}'`;
}

export function countsByRelationship(edges: readonly DependencyEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.relationship, (counts.get(edge.relationship) ?? 0) + 1);
  }
  return counts;
}
