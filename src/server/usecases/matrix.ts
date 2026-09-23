import { limitExceeded, type Limits } from '@/domain/limits';
import { limitsForSpaceId, limitsOf } from '@/server/limits';
import { ValidationError } from '@/domain/errors';
import type { ExternalDefinition } from '@/domain/properties/external';
import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import { RqlSyntaxError } from '@/domain/ryql/errors';
import {
  columnId,
  parseMatrixConfig,
  type MatrixConfig,
  type MatrixPage,
  type MatrixRow,
} from '@/domain/traceability/matrix';
import { requireSpace } from '@/server/authz';
import {
  baselineOfReportDocument,
  deleteSavedMatrix,
  findSavedMatrix,
  listSavedMatrices,
  saveMatrix,
} from '@/server/repositories/matrices';
import { groupIdsOf, runSearch, visibilityPredicate } from '@/server/repositories/search';
import { listDefinitions, loadExternalTypes } from '@/server/repositories/external-properties';
import { fetchDefiningDocuments, fetchMatrixCells } from '@/server/repositories/traceability';

export type MatrixSuccess = {
  ok: true;
  page: MatrixPage;
  warnings: RqlDiagnostic[];
  /**
   * The definitions behind the `external` columns of this config, so the screen can offer
   * the right input and compute the column's aggregate (spec 04 §2.1–2.2).
   */
  definitions: ExternalDefinition[];
};
export type MatrixFailure = { ok: false; errors: RqlDiagnostic[] };

export type RunMatrixInput = {
  spaceKey: string;
  config: unknown;
  offset?: number;
  /** The document an embedded matrix lives in — resolves `$currentBaseline` (spec 04 §2.3). */
  documentId?: string | null;
  crossSpace?: boolean;
};

export type MatrixSpace = { id: string; key: string; isolated: boolean };

/**
 * Runs a traceability matrix in two phases: a page of requirement ids from the RQL query,
 * then one batched fetch per column kind for exactly those ids.
 * spec: 04-traceability-and-coverage.md §2
 *
 * Takes the space and the reader explicitly, because the export job runs it in a worker
 * where there is no session — with the same visibility predicate either way (rule X3).
 */
export async function runMatrixForUser(input: {
  space: MatrixSpace;
  userId: string;
  config: unknown;
  offset?: number;
  documentId?: string | null;
  crossSpace?: boolean;
}): Promise<MatrixSuccess | MatrixFailure> {
  const space = input.space;
  const user = { id: input.userId };
  // A stored config from before a space lowered its limit is clamped, not refused: it was
  // valid when saved. A new request over the limit is refused by the use cases below.
  const config = parseMatrixConfig(input.config, (await limitsForSpaceId(space.id)).matrixPageSizeMax);

  if (config.query.trim().length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'SYNTAX_ERROR',
          severity: 'error',
          message: 'A matrix needs a query to drive its rows.',
          offset: 0,
          length: 0,
          hint: "For example: key ~ 'FN-%'",
        },
      ],
    };
  }

  const externalTypes = await loadExternalTypes();
  const analysed = parseAndAnalyse(config.query, {
    spaceKey: space.key,
    isolated: space.isolated,
    crossSpace: input.crossSpace ?? false,
    defaultBaseline: null,
    externalTypes,
  });
  if (!analysed.ok) return { ok: false, errors: analysed.errors };

  const baseline = input.documentId ? await baselineOfReportDocument(input.documentId) : null;
  const visibility = visibilityPredicate(user.id, await groupIdsOf(user.id));

  try {
    // Phase one: the page of rows.
    const { rows, total } = await runSearch(analysed.query.expr, {
      visibility,
      externalTypes,
      knownSpaces: { [space.key]: space.id },
      // `$currentBaseline` resolves to the baseline this document reports on, and to the
      // live set when it reports on none (RD-031).
      currentBaselineId: baseline?.id ?? null,
      limit: config.pageSize,
      offset: Math.max(input.offset ?? 0, 0),
    });

    // Phase two: one batched query per column kind.
    const ids = rows.map((row) => row.id);
    const [documents, cells] = await Promise.all([
      fetchDefiningDocuments(ids),
      fetchMatrixCells({ rows, columns: config.columns, visibility }),
    ]);

    const matrixRows: MatrixRow[] = rows.map((row) => {
      const document = documents.get(row.id);
      const assembled = cells.get(row.id) ?? {};
      const documentColumn = config.columns.find((column) => column.kind === 'document');
      if (documentColumn) {
        assembled[columnId(documentColumn)] = { text: document?.documentTitle ?? '' };
      }

      return {
        id: row.id,
        key: row.key,
        spaceKey: row.spaceId === space.id ? null : null,
        documentId: document?.documentId ?? null,
        documentTitle: document?.documentTitle ?? null,
        cells: assembled,
      };
    });

    const wanted = new Set(
      config.columns.flatMap((column) => (column.kind === 'external' ? [column.name.trim().toLowerCase()] : [])),
    );
    const definitions = wanted.size
      ? (await listDefinitions()).filter((definition) => wanted.has(definition.searchName))
      : [];

    return {
      ok: true,
      page: { config, rows: matrixRows, total, offset: Math.max(input.offset ?? 0, 0) },
      warnings: analysed.warnings,
      definitions,
    };
  } catch (error) {
    if (error instanceof RqlSyntaxError) return { ok: false, errors: [error.diagnostic] };
    throw error;
  }
}

/** spec 07 §4 — asking for a page above the limit is an error naming it, not a silent clamp. */
function refuseOversizedPage(config: unknown, limits: Limits): void {
  const requested = typeof config === 'object' && config !== null ? (config as { pageSize?: unknown }).pageSize : undefined;
  if (typeof requested === 'number' && requested > limits.matrixPageSizeMax) {
    throw limitExceeded('matrixPageSizeMax', limits.matrixPageSizeMax, requested, `a page of ${requested} rows was requested`);
  }
}

export async function runMatrixUseCase(input: RunMatrixInput): Promise<MatrixSuccess | MatrixFailure> {
  const { space, user } = await requireSpace(input.spaceKey);
  refuseOversizedPage(input.config, limitsOf(space));
  return runMatrixForUser({
    space: { id: space.id, key: space.key, isolated: space.isolated },
    userId: user.id,
    config: input.config,
    offset: input.offset ?? 0,
    documentId: input.documentId ?? null,
    crossSpace: input.crossSpace ?? false,
  });
}

export async function listMatricesUseCase(spaceKey: string) {
  const { space, user } = await requireSpace(spaceKey);
  return listSavedMatrices(space.id, user.id);
}

/** spec 04 §2.3 — a saved matrix has a name and a visibility. `public-link` is RD-030. */
export async function saveMatrixUseCase(input: {
  spaceKey: string;
  name: unknown;
  config: unknown;
  visibility?: string;
}) {
  const { space, user } = await requireSpace(input.spaceKey, 'EDIT');
  refuseOversizedPage(input.config, limitsOf(space));
  const config = parseMatrixConfig(input.config);

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) throw new ValidationError('A saved matrix needs a name.');
  if (config.query.trim().length === 0) throw new ValidationError('A saved matrix needs a query.');

  const analysed = parseAndAnalyse(config.query, {
    spaceKey: space.key,
    isolated: space.isolated,
    externalTypes: await loadExternalTypes(),
  });
  if (!analysed.ok) {
    throw new ValidationError(`That query does not parse: ${analysed.errors[0]?.message ?? 'unknown error'}`);
  }

  if (input.visibility === 'public-link') {
    // RD-030: an anonymous URL contradicts the mandatory visibility predicate (rule X3).
    throw new ValidationError(
      'Public links are not available yet: every matrix is filtered by what the signed-in reader may see (RD-030).',
    );
  }

  return saveMatrix({
    spaceId: space.id,
    name,
    kind: 'TRACEABILITY',
    query: config.query,
    columns: config.columns as unknown as Parameters<typeof saveMatrix>[0]['columns'],
    visibility: input.visibility === 'private' ? 'private' : 'space',
    ownerId: user.id,
  });
}

export async function deleteMatrixUseCase(spaceKey: string, id: string): Promise<void> {
  const { space } = await requireSpace(spaceKey, 'EDIT');
  await deleteSavedMatrix(space.id, id);
}

/** Loads a saved matrix as a config, for the screen and for an embed. */
export async function loadSavedMatrixUseCase(
  spaceKey: string,
  id: string,
): Promise<{ name: string; config: MatrixConfig } | null> {
  const { space } = await requireSpace(spaceKey);
  const saved = await findSavedMatrix(id);
  if (!saved || saved.spaceId !== space.id) return null;

  return {
    name: saved.name,
    config: parseMatrixConfig({ query: saved.query, columns: saved.columns }),
  };
}
