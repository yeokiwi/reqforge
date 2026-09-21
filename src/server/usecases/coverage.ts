import { ValidationError } from '@/domain/errors';
import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import {
  computeCoverage,
  findRelationshipCollisions,
  queriesForRow,
  type CoverageCount,
  type CoverageRow,
  type RelationshipCollision,
} from '@/domain/traceability/coverage';
import { emptyQueryRefusal, type CapRefusal } from '@/domain/traceability/dependency-matrix';
import { requireSpace } from '@/server/authz';
import {
  clearCoverageTarget,
  listCoverageTargets,
  setCoverageTarget,
} from '@/server/repositories/coverage-targets';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { loadExternalTypes } from '@/server/repositories/external-properties';
import { fetchCoverageCounts } from '@/server/repositories/traceability';

export type CoverageSuccess = {
  ok: true;
  population: number;
  rows: Array<CoverageRow & { coveredQuery: string; uncoveredQuery: string }>;
  collisions: RelationshipCollision[];
  query: string;
};
export type CoverageRefused = { ok: false; refusal: CapRefusal };
export type CoverageInvalid = { ok: false; errors: RqlDiagnostic[] };

export type CoverageResult = CoverageSuccess | CoverageRefused | CoverageInvalid;

/**
 * Coverage over a population.
 * spec: 04-traceability-and-coverage.md §4 — gated on EXPORT with the dependency matrix
 * (§4.3), refuses an empty query, and reports count *and* percentage (`RD-004`).
 */
export async function runCoverageUseCase(input: {
  spaceKey: string;
  query: unknown;
}): Promise<CoverageResult> {
  const { space, user } = await requireSpace(input.spaceKey, 'EXPORT');
  const query = typeof input.query === 'string' ? input.query.trim() : '';

  if (query.length === 0) return { ok: false, refusal: emptyQueryRefusal() };

  const externalTypes = await loadExternalTypes();
  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    defaultBaseline: null,
    externalTypes,
  });
  if (!analysed.ok) return { ok: false, errors: analysed.errors };

  const visibility = visibilityPredicate(user.id, await groupIdsOf(user.id));

  // The denominator is what this reader can see — the predicate does that (rule X2).
  const ids = await runSearchIds(analysed.query.expr, { visibility, externalTypes });
  const [{ perRelationship, anyTo, anyFrom }, targets] = await Promise.all([
    fetchCoverageCounts(ids),
    listCoverageTargets(space.id),
  ]);

  const counts: CoverageCount[] = [
    { relationship: null, direction: 'to', covered: anyTo },
    { relationship: null, direction: 'from', covered: anyFrom },
    ...perRelationship.map((row) => ({
      relationship: row.relationship,
      direction: row.direction,
      covered: Number(row.covered),
    })),
  ];

  const rows = computeCoverage(
    ids.length,
    counts,
    targets.map((target) => ({
      relationship: target.relationship,
      direction: target.direction === 'from' ? ('from' as const) : ('to' as const),
      targetPercent: target.targetPercent,
    })),
  );

  return {
    ok: true,
    population: ids.length,
    rows: rows.map((row) => {
      const queries = queriesForRow(row, query);
      return { ...row, coveredQuery: queries.covered, uncoveredQuery: queries.uncovered };
    }),
    // RD-032: names differing only by case or whitespace are surfaced, never merged.
    collisions: findRelationshipCollisions(perRelationship.map((row) => row.relationship)),
    query,
  };
}

/** spec 04 §4.2 — targets are space configuration, so they need ADMIN. */
export async function setCoverageTargetUseCase(input: {
  spaceKey: string;
  relationship: unknown;
  direction: unknown;
  targetPercent: unknown;
}) {
  const { space } = await requireSpace(input.spaceKey, 'ADMIN');

  const relationship = typeof input.relationship === 'string' ? input.relationship.trim() : '';
  if (relationship.length === 0) throw new ValidationError('A target needs a relationship.');

  const direction = input.direction === 'from' ? 'from' : 'to';
  const percent = Number(input.targetPercent);
  if (!Number.isFinite(percent)) throw new ValidationError('A target needs a percentage between 0 and 100.');

  return setCoverageTarget({ spaceId: space.id, relationship, direction, targetPercent: percent });
}

export async function clearCoverageTargetUseCase(spaceKey: string, id: string): Promise<void> {
  const { space } = await requireSpace(spaceKey, 'ADMIN');
  await clearCoverageTarget(space.id, id);
}

export async function listCoverageTargetsUseCase(spaceKey: string) {
  const { space } = await requireSpace(spaceKey, 'EXPORT');
  return listCoverageTargets(space.id);
}
