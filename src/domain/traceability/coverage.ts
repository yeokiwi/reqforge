import type { DependencyDirection } from './dependencies';
import { DIRECTION_FIELDS, DIRECTION_LABELS } from './dependencies';

/**
 * Coverage over a population.
 * spec: 04-traceability-and-coverage.md §4.1
 *
 *   covered(r, d)   = { q ∈ P : ∃ dependency of relationship r, direction d, from q }
 *   uncovered(r, d) = P \ covered(r, d)
 *   coverage(r, d)  = |covered(r, d)| / |P|
 *
 * Requirement Yogi reports counts only (research §4.4); we report both count and
 * percentage (`RD-004`).
 */
export type CoverageCount = {
  relationship: string | null; // null is the synthetic "any dependency" row
  direction: DependencyDirection;
  covered: number;
};

export type CoverageTarget = { relationship: string; direction: DependencyDirection; targetPercent: number };

export type CoverageRow = {
  relationship: string | null;
  direction: DependencyDirection;
  label: string;
  population: number;
  covered: number;
  uncovered: number;
  /** 0–100, rounded to one decimal. `population === 0` reports 0 rather than NaN. */
  percent: number;
  targetPercent: number | null;
  belowTarget: boolean;
};

export const ANY_DEPENDENCY_LABEL = 'Any dependency';

function percentOf(covered: number, population: number): number {
  if (population <= 0) return 0;
  return Math.round((covered / population) * 1000) / 10;
}

function labelFor(relationship: string | null, direction: DependencyDirection): string {
  const base = DIRECTION_LABELS[direction];
  return relationship === null ? `${base} — ${ANY_DEPENDENCY_LABEL.toLowerCase()}` : `${base} — ${relationship}`;
}

/**
 * One row per (relationship, direction) discovered in the population, plus the synthetic
 * "any dependency" row for each direction.
 * spec: 04 §4.2
 */
export function computeCoverage(
  population: number,
  counts: readonly CoverageCount[],
  targets: readonly CoverageTarget[] = [],
): CoverageRow[] {
  const targetOf = new Map(
    targets.map((target) => [`${target.direction}:${target.relationship}`, target.targetPercent]),
  );

  const rows = counts.map((count) => {
    const covered = Math.min(count.covered, population);
    const percent = percentOf(covered, population);
    const targetPercent =
      count.relationship === null ? null : (targetOf.get(`${count.direction}:${count.relationship}`) ?? null);

    return {
      relationship: count.relationship,
      direction: count.direction,
      label: labelFor(count.relationship, count.direction),
      population,
      covered,
      uncovered: population - covered,
      percent,
      targetPercent,
      belowTarget: targetPercent !== null && percent < targetPercent,
    };
  });

  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.direction.localeCompare(b.direction) ||
      (a.relationship ?? '').localeCompare(b.relationship ?? ''),
  );
}

/** The synthetic rows sort first: they are the headline numbers. */
function rank(row: CoverageRow): number {
  return row.relationship === null ? 0 : 1;
}

/** An RQL qualifier needs quoting when the relationship contains whitespace (RD-011). */
function qualifier(relationship: string): string {
  return /\s/.test(relationship) ? `@'${relationship}'` : `@${relationship}`;
}

/**
 * The queries behind each figure, so every number on the screen is clickable and the
 * uncovered set is directly listable (spec 04 §4.1, research §4.4).
 */
export function queriesForRow(row: CoverageRow, populationQuery: string): { covered: string; uncovered: string } {
  const field = DIRECTION_FIELDS[row.direction];
  const reference = row.relationship === null ? field : `${field}${qualifier(row.relationship)}`;
  const population = populationQuery.trim();
  const scope = population.length > 0 ? `(${population}) AND ` : '';

  // RD-006 made IS NULL / IS NOT NULL valid on every field, which is what lets the
  // uncovered set be a query rather than a bespoke endpoint.
  return {
    covered: `${scope}${reference} IS NOT NULL`,
    uncovered: `${scope}${reference} IS NULL`,
  };
}

export type RelationshipCollision = { names: string[]; reason: 'case' | 'whitespace' };

/**
 * RD-032: relationship names are compared case-sensitively, like property names. Rather
 * than silently merging `Refines` and `refines`, coverage surfaces the collision — the
 * same principle as rule S3, which refuses to pick a winner between two definitions.
 */
export function findRelationshipCollisions(relationships: readonly string[]): RelationshipCollision[] {
  const byNormalised = new Map<string, Set<string>>();

  for (const relationship of relationships) {
    const normalised = relationship.trim().toLowerCase().replace(/\s+/g, ' ');
    const group = byNormalised.get(normalised) ?? new Set<string>();
    group.add(relationship);
    byNormalised.set(normalised, group);
  }

  return [...byNormalised.values()]
    .filter((group) => group.size > 1)
    .map((group) => {
      // Case-insensitive first, then by code unit, so `Refines` reads before `refines`
      // rather than the other way round (locale collation puts lowercase first).
      const names = [...group].sort(
        (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0),
      );
      const sameIgnoringCase = new Set(names.map((name) => name.replace(/\s+/g, ' '))).size > 1;
      return { names, reason: sameIgnoringCase ? ('case' as const) : ('whitespace' as const) };
    });
}
