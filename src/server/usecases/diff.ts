import { ValidationError } from '@/domain/errors';
import {
  diffSides,
  EXPORT_REQUIRED_ABOVE,
  parseDiffRequest,
  type ComparableRow,
  type DiffOutcome,
  type DiffRequest,
} from '@/domain/diff';
import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import { requireSpace } from '@/server/authz';
import { prisma } from '@/server/repositories/client';
import { loadExternalTypes } from '@/server/repositories/external-properties';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';

/**
 * The diff.
 * spec: 05-baselines-and-diff.md §5 — query-driven, not baseline-pair-driven, because
 * "selecting two baselines merely pre-fills them" (research §5.5) and that makes
 * "diff a subset" free.
 */

export type DiffSuccess = { ok: true; request: DiffRequest; outcome: DiffOutcome; warnings: RqlDiagnostic[] };
export type DiffFailure = { ok: false; errors: RqlDiagnostic[]; side?: 'left' | 'right' };

/**
 * Both sides resolved under the mandatory visibility predicate (rule X3), so a row the
 * reader may not see appears on neither side — and therefore never shows as added or
 * removed, which would leak its existence.
 */
export async function runDiff(input: {
  spaceKey: string;
  request: unknown;
  /** Raised for the export path, which is not bound by the interactive limit. */
  maxRows?: number;
}): Promise<DiffSuccess | DiffFailure> {
  const { space, user } = await requireSpace(input.spaceKey);
  return runDiffForUser({
    space: { id: space.id, key: space.key, isolated: space.isolated },
    userId: user.id,
    request: input.request,
    ...(input.maxRows !== undefined ? { maxRows: input.maxRows } : {}),
  });
}

/**
 * The comparison itself, with the space and the reader given explicitly — the export job
 * runs it in a worker where there is no session, under the same visibility predicate
 * either way (rule X3).
 */
export async function runDiffForUser(input: {
  space: { id: string; key: string; isolated: boolean };
  userId: string;
  request: unknown;
  maxRows?: number;
}): Promise<DiffSuccess | DiffFailure> {
  const space = input.space;
  const user = { id: input.userId };
  const request = parseDiffRequest(input.request);

  if (request.left.length === 0 || request.right.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'SYNTAX_ERROR',
          severity: 'error',
          message: 'A diff needs a query on each side.',
          offset: 0,
          length: 0,
          hint: 'For example: baseline = 1 on the left, and the live requirements on the right.',
        },
      ],
    };
  }

  const externalTypes = await loadExternalTypes();
  const visibility = visibilityPredicate(user.id, await groupIdsOf(user.id));

  type Resolved = { ids: string[]; warnings: RqlDiagnostic[] };

  const resolve = async (side: 'left' | 'right'): Promise<Resolved | DiffFailure> => {
    const analysed = parseAndAnalyse(request[side], {
      spaceKey: space.key,
      isolated: space.isolated,
      defaultBaseline: null,
      externalTypes,
    });
    if (!analysed.ok) return { ok: false, errors: analysed.errors, side };

    return {
      ids: await runSearchIds(analysed.query.expr, { visibility, externalTypes }),
      warnings: analysed.warnings,
    };
  };

  const [left, right] = await Promise.all([resolve('left'), resolve('right')]);
  if ('ok' in left) return left;
  if ('ok' in right) return right;

  const total = left.ids.length + right.ids.length;

  // spec 05 §5.4 — beyond this the UI requires the export path.
  if (input.maxRows === undefined && total > EXPORT_REQUIRED_ABOVE) {
    throw new ValidationError(
      `That comparison covers ${total} requirements; above ${EXPORT_REQUIRED_ABOVE} the diff runs as an export.`,
    );
  }

  const [leftRows, rightRows] = await Promise.all([loadComparable(left.ids), loadComparable(right.ids)]);

  return {
    ok: true,
    request,
    outcome: diffSides(
      leftRows,
      rightRows,
      request.compare,
      request.ignore,
      request.filter,
      input.maxRows ?? request.limit,
    ),
    warnings: [...left.warnings, ...right.warnings],
  };
}

/**
 * Everything a comparison needs, in three batched queries — never one per row
 * (spec 04 §2.5's rule applies here too).
 */
export async function loadComparable(ids: readonly string[]): Promise<ComparableRow[]> {
  if (ids.length === 0) return [];

  const rows = await prisma.requirement.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { upperKey: 'asc' },
    select: {
      id: true,
      key: true,
      title: true,
      bodyHtml: true,
      bodySearch: true,
      properties: { select: { kind: true, searchName: true, value: true, valueIndex: true } },
      parentEdges: { select: { relationship: true, parent: { select: { upperKey: true } } } },
    },
  });

  return rows.map((row) => ({
    key: row.key,
    title: row.title,
    bodyHtml: row.bodyHtml,
    bodySearch: row.bodySearch,
    inlineProperties: row.properties
      .filter((property) => property.kind === 'INLINE')
      .map(({ searchName, value, valueIndex }) => ({ searchName, value, valueIndex })),
    externalProperties: row.properties
      .filter((property) => property.kind === 'EXTERNAL')
      .map(({ searchName, value, valueIndex }) => ({ searchName, value, valueIndex })),
    dependencies: row.parentEdges.map((edge) => ({
      relationship: edge.relationship,
      targetKey: edge.parent.upperKey,
    })),
  }));
}
