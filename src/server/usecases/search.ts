import { ValidationError } from '@/domain/errors';
import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import { RqlSyntaxError } from '@/domain/ryql/errors';
import { printExpr } from '@/domain/ryql/print';
import { requireSpace } from '@/server/authz';
import { loadExternalTypes } from '@/server/repositories/external-properties';
import {
  deleteSavedSearch,
  groupIdsOf,
  listSavedSearches,
  runSearch,
  saveSearch,
  visibilityPredicate,
  type SearchRow,
} from '@/server/repositories/search';

export type SearchOptions = {
  spaceKey: string;
  query: string;
  crossSpace?: boolean;
  baseline?: number | null;
  limit?: number;
  offset?: number;
  /** Keyset cursor for the API (RD-068); the screens keep their offset paging. */
  after?: { upperKey: string; id: string };
  /** False skips the count, which the API never shows (RD-068). */
  count?: boolean;
};

export type SearchSuccess = {
  ok: true;
  rows: SearchRow[];
  total: number;
  warnings: RqlDiagnostic[];
  /** The query as Reqforge read it, with implied parentheses (spec 02 §3.1). */
  reading: string;
  injected: string[];
};

export type SearchFailure = { ok: false; errors: RqlDiagnostic[] };

export async function searchUseCase(options: SearchOptions): Promise<SearchSuccess | SearchFailure> {
  const { space, user } = await requireSpace(options.spaceKey);

  const externalTypes = await loadExternalTypes();
  const analysed = parseAndAnalyse(options.query, {
    spaceKey: space.key,
    isolated: space.isolated,
    crossSpace: options.crossSpace ?? false,
    defaultBaseline: options.baseline ?? null,
    externalTypes,
  });

  if (!analysed.ok) return { ok: false, errors: analysed.errors };

  const visibility = visibilityPredicate(user.id, await groupIdsOf(user.id));

  try {
    const { rows, total } = await runSearch(
      analysed.query.expr,
      {
        visibility,
        externalTypes,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        ...(options.after ? { after: options.after } : {}),
      },
      { count: options.count ?? true },
    );

    return {
      ok: true,
      rows,
      total,
      warnings: analysed.warnings,
      reading: printExpr(analysed.query.userExpr),
      injected: analysed.query.injected,
    };
  } catch (error) {
    // The compiler refuses what belongs to a later slice with a typed diagnostic.
    if (error instanceof RqlSyntaxError) return { ok: false, errors: [error.diagnostic] };
    throw error;
  }
}

export async function listSavedSearchesUseCase(spaceKey: string) {
  const { space, user } = await requireSpace(spaceKey);
  return listSavedSearches(space.id, user.id);
}

export async function saveSearchUseCase(input: {
  spaceKey: string;
  name: unknown;
  query: unknown;
  visibility?: string;
}) {
  const { space, user } = await requireSpace(input.spaceKey, 'EDIT');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (name.length === 0) throw new ValidationError('A saved search needs a name.');
  if (query.length === 0) throw new ValidationError('A saved search needs a query.');

  // Never store a query that does not parse.
  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    externalTypes: await loadExternalTypes(),
  });
  if (!analysed.ok) {
    throw new ValidationError(`That query does not parse: ${analysed.errors[0]?.message ?? 'unknown error'}`);
  }

  return saveSearch({
    spaceId: space.id,
    name,
    query,
    ownerId: user.id,
    visibility: input.visibility === 'private' ? 'private' : 'space',
  });
}

export async function deleteSavedSearchUseCase(spaceKey: string, id: string): Promise<void> {
  const { space } = await requireSpace(spaceKey, 'EDIT');
  await deleteSavedSearch(space.id, id);
}
