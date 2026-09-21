import { NotFoundError } from '@/domain/errors';
import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import {
  AXIS_CAP,
  buildGrid,
  capRefusalFor,
  emptyQueryRefusal,
  type CapRefusal,
  type Grid,
} from '@/domain/traceability/dependency-matrix';
import { requireSpace } from '@/server/authz';
import { groupIdsOf, runSearch, visibilityPredicate } from '@/server/repositories/search';
import { fetchDefiningDocuments, fetchEdgesWithin } from '@/server/repositories/traceability';

export type GridSuccess = {
  ok: true;
  grid: Grid;
  population: number;
  documentTitles: Array<[string, string]>;
};
export type GridRefused = { ok: false; refusal: CapRefusal };
export type GridInvalid = { ok: false; errors: RqlDiagnostic[] };

export type GridResult = GridSuccess | GridRefused | GridInvalid;

export function isRefusal(result: GridResult): result is GridRefused {
  return !result.ok && 'refusal' in result;
}

/**
 * The dependency matrix.
 * spec: 04-traceability-and-coverage.md §3 and §4.3 — gated on EXPORT because the cost is
 * generating the grid, and refusing an empty query is RY's own guidance (research §4.3).
 */
export async function runDependencyMatrixUseCase(input: {
  spaceKey: string;
  query: unknown;
}): Promise<GridResult> {
  const { space, user } = await requireSpace(input.spaceKey, 'EXPORT');
  const query = typeof input.query === 'string' ? input.query.trim() : '';

  if (query.length === 0) return { ok: false, refusal: emptyQueryRefusal() };

  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    defaultBaseline: null,
  });
  if (!analysed.ok) return { ok: false, errors: analysed.errors };

  const visibility = visibilityPredicate(user.id, await groupIdsOf(user.id));

  // One page at the cap is enough to know whether we are over it: runSearch reports the
  // full total regardless of the limit.
  const { rows, total } = await runSearch(analysed.query.expr, { visibility, limit: AXIS_CAP, offset: 0 });

  const refusal = capRefusalFor(total);
  if (refusal) return { ok: false, refusal };

  const ids = rows.map((row) => row.id);
  const [edges, documents] = await Promise.all([fetchEdgesWithin(ids), fetchDefiningDocuments(ids)]);

  const grid = buildGrid(
    rows.map((row) => ({ key: row.key, title: row.title })),
    edges,
  );

  return {
    ok: true,
    grid,
    population: total,
    documentTitles: rows
      .map((row): [string, string] => [row.key, documents.get(row.id)?.documentTitle ?? ''])
      .filter(([, title]) => title.length > 0),
  };
}

/** Used by the export job, which has no session and no cap beyond the axis limit. */
export async function dependencyMatrixForUser(input: {
  space: { id: string; key: string; isolated: boolean };
  userId: string;
  query: string;
  offset: number;
  limit: number;
}): Promise<{ rows: Array<{ id: string; key: string; title: string }>; total: number }> {
  const analysed = parseAndAnalyse(input.query, {
    spaceKey: input.space.key,
    isolated: input.space.isolated,
    defaultBaseline: null,
  });
  if (!analysed.ok) throw new NotFoundError(analysed.errors[0]?.message ?? 'That query is not valid.');

  const visibility = visibilityPredicate(input.userId, await groupIdsOf(input.userId));
  const { rows, total } = await runSearch(analysed.query.expr, {
    visibility,
    limit: input.limit,
    offset: input.offset,
  });

  return { rows: rows.map((row) => ({ id: row.id, key: row.key, title: row.title })), total };
}
