import { NotFoundError, QueryError } from '@/domain/errors';
import { parseAndAnalyse, printExpr, type RqlDiagnostic } from '@/domain/ryql';
import { requireSpace } from '@/server/authz';
import { toApiRequirements, type ApiRequirement, type Expansion } from '@/server/repositories/api-requirements';
import { findBaselineByNumber, pinnedVersionsOf } from '@/server/repositories/baselines';
import { loadExternalTypes } from '@/server/repositories/external-properties';
import { listHistory } from '@/server/repositories/history';
import { findRequirementDetail } from '@/server/repositories/requirements';
import { searchUseCase } from './search';
import type { Cursor } from '@/server/api/cursor';

/**
 * The use cases only the REST API needs. spec: 08-api-surface.md §2, §4, §5. Each one
 * goes through `requireSpace` and the visibility layer exactly as the screens do — there
 * is no privileged API path (§1).
 */

/**
 * With no `q`, the list is every live requirement the caller may see. RQL has no empty
 * query (spec 02 §3), so this is spelled as a predicate that is always true for a row,
 * and the default scope (spec 02 §8) then narrows it to live, ACTIVE requirements in the
 * space — the same rows the search screen shows for the same scope.
 */
const EVERYTHING = 'key IS NOT NULL';

export type RequirementPage = {
  items: ApiRequirement[];
  hasMore: boolean;
  nextCursor: Cursor | null;
  warnings: RqlDiagnostic[];
  reading: string;
};

export async function listRequirementsForApi(input: {
  spaceKey: string;
  q?: string;
  baseline?: number;
  limit: number;
  after?: Cursor;
  expand: ReadonlySet<Expansion>;
}): Promise<RequirementPage> {
  const { viewer } = await requireSpace(input.spaceKey);
  const query = input.q?.trim() || EVERYTHING;
  const common = {
    spaceKey: input.spaceKey,
    query,
    baseline: input.baseline ?? null,
    count: false,
  } as const;

  const page = await searchUseCase({ ...common, limit: input.limit, ...(input.after ? { after: input.after } : {}) });
  if (!page.ok) throw new QueryError(page.errors[0]?.message ?? 'That query is not valid.', { errors: page.errors });

  // RD-068 — `hasMore` from a one-row keyset probe past the page, rather than a count
  // (which can cost as much as the search) or a page of 601 (which the compiler caps).
  const last = page.rows.at(-1);
  let hasMore = false;
  if (last && page.rows.length === input.limit) {
    const probe = await searchUseCase({ ...common, limit: 1, after: { upperKey: last.upperKey, id: last.id } });
    hasMore = probe.ok && probe.rows.length > 0;
  }

  return {
    items: await toApiRequirements(viewer, page.rows, input.expand),
    hasMore,
    nextCursor: hasMore && last ? { upperKey: last.upperKey, id: last.id } : null,
    warnings: page.warnings,
    reading: page.reading,
  };
}

async function baselineIdOf(spaceId: string, spaceKey: string, baseline: number | 'current'): Promise<string | null> {
  if (baseline === 'current') return null;
  const found = await findBaselineByNumber(spaceId, baseline);
  if (!found) throw new NotFoundError(`Baseline ${baseline} does not exist in ${spaceKey}.`);
  return found.id;
}

/** spec 08 §2 — one requirement, live or as frozen in a baseline. 404 if hidden (RD-064). */
export async function requirementForApi(input: {
  spaceKey: string;
  key: string;
  baseline: number | 'current';
  expand: ReadonlySet<Expansion>;
}): Promise<ApiRequirement> {
  const { space, viewer } = await requireSpace(input.spaceKey);
  const baselineId = await baselineIdOf(space.id, space.key, input.baseline);
  const detail = await findRequirementDetail(viewer, space.id, input.key, baselineId);
  if (!detail) throw new NotFoundError(`${input.key} does not exist in ${input.spaceKey}.`);
  const [item] = await toApiRequirements(viewer, [detail], input.expand);
  return item!;
}

/** spec 08 §2 — a requirement's change history (spec 05 §6). */
export async function requirementHistoryForApi(input: { spaceKey: string; key: string; limit: number }) {
  const { space, viewer } = await requireSpace(input.spaceKey);
  const detail = await findRequirementDetail(viewer, space.id, input.key, null);
  if (!detail) throw new NotFoundError(`${input.key} does not exist in ${input.spaceKey}.`);
  const rows = await listHistory({ viewer, spaceId: space.id, requirementId: detail.id, limit: input.limit });
  return {
    enabled: space.historyEnabled,
    items: rows.map((row) => ({
      at: row.at.toISOString(),
      actorId: row.actorId,
      changeKind: row.changeKind,
      before: row.before,
      after: row.after,
    })),
  };
}

/** The requirement's internal id, for the external-property write path. */
export async function requirementIdForApi(spaceKey: string, key: string): Promise<string> {
  const { space, viewer } = await requireSpace(spaceKey);
  const detail = await findRequirementDetail(viewer, space.id, key, null);
  if (!detail) throw new NotFoundError(`${key} does not exist in ${spaceKey}.`);
  return detail.id;
}

/**
 * spec 08 §5 — "parse an RQL string, return AST summary or errors — powers editor
 * underlining". Parse and analyse only; nothing is executed.
 */
export async function validateQueryForApi(spaceKey: string, query: string) {
  const { space } = await requireSpace(spaceKey);
  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    defaultBaseline: null,
    externalTypes: await loadExternalTypes(),
  });
  if (!analysed.ok) return { ok: false as const, errors: analysed.errors };
  return {
    ok: true as const,
    reading: printExpr(analysed.query.userExpr),
    injected: analysed.query.injected,
    warnings: analysed.warnings,
  };
}

/** spec 08 §4 — the document versions a baseline pinned. */
export async function pinnedDocumentsForApi(spaceKey: string, number: number) {
  const { space, viewer } = await requireSpace(spaceKey);
  const baseline = await findBaselineByNumber(space.id, number);
  if (!baseline) throw new NotFoundError(`Baseline ${number} does not exist in ${spaceKey}.`);
  return pinnedVersionsOf(viewer, baseline.id);
}

export async function baselineIdByNumber(spaceKey: string, number: number): Promise<string> {
  const { space } = await requireSpace(spaceKey);
  const baseline = await findBaselineByNumber(space.id, number);
  if (!baseline) throw new NotFoundError(`Baseline ${number} does not exist in ${spaceKey}.`);
  return baseline.id;
}
