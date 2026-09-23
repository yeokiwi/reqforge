import { z } from 'zod/v4';
import { ValidationError } from '@/domain/errors';
import { validateQueryForApi } from '@/server/usecases/api';
import { runCoverageUseCase } from '@/server/usecases/coverage';
import { runDependencyMatrixUseCase } from '@/server/usecases/dependency-matrix';
import { runDiff } from '@/server/usecases/diff';
import { exportDependencyMatrixUseCase, exportDiffUseCase, exportMatrixUseCase } from '@/server/usecases/jobs';
import { runMatrixUseCase } from '@/server/usecases/matrix';
import { cursorSchema, decodePositionCursor, encodePositionCursor } from '../cursor';
import { defineRoute, queryProblem } from '../define-route';
import { accepted, jobView, rqlDiagnostic, spaceParams } from '../schemas';

/** spec: 08-api-surface.md §5 — analysis. Each is the screen's own use case, over HTTP. */

const TAG = 'Analysis';

export const validateQuery = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/search/validate',
  tag: TAG,
  summary: 'Parse and analyse an RQL string without running it — for editor underlining',
  params: spaceParams,
  body: z.object({ query: z.string().max(4_000) }),
  response: z.union([
    z.object({ ok: z.literal(true), reading: z.string(), injected: z.array(z.string()), warnings: z.array(rqlDiagnostic) }),
    z.object({ ok: z.literal(false), errors: z.array(rqlDiagnostic) }),
  ]),
  // A query that does not parse is this endpoint's answer, not its failure: 200 either way.
  handler: async ({ params, body }) => validateQueryForApi(params.spaceKey, body.query),
});

export const traceability = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/traceability',
  tag: TAG,
  summary: 'A page of a traceability matrix for a MatrixConfig',
  params: spaceParams,
  query: z.object({ cursor: cursorSchema }),
  body: z.object({ config: z.looseObject({ query: z.string(), columns: z.array(z.unknown()) }) }),
  response: z.object({
    items: z.array(z.looseObject({ key: z.string(), cells: z.record(z.string(), z.unknown()) })),
    total: z.number().int(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    warnings: z.array(rqlDiagnostic),
  }),
  handler: async ({ params, query, body }) => {
    const offset = decodePositionCursor(query.cursor);
    const result = await runMatrixUseCase({ spaceKey: params.spaceKey, config: body.config, offset });
    if (!result.ok) queryProblem(result.errors);
    const next = offset + result.page.rows.length;
    const hasMore = next < result.page.total && result.page.rows.length > 0;
    return {
      items: result.page.rows,
      total: result.page.total,
      hasMore,
      nextCursor: hasMore ? encodePositionCursor(next) : null,
      warnings: result.warnings,
    };
  },
});

const refusal = z.object({
  ok: z.literal(false),
  refusal: z.object({
    reason: z.enum(['over-cap', 'empty-query']),
    population: z.number().int(),
    axisCap: z.number().int(),
    cellCap: z.number().int(),
    message: z.string(),
  }),
});

export const dependencies = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/dependencies',
  tag: TAG,
  summary: 'The dependency grid, or a refusal over the cell cap (needs EXPORT)',
  params: spaceParams,
  body: z.object({ query: z.string().max(4_000) }),
  response: z.union([
    z.object({
      ok: z.literal(true),
      population: z.number().int(),
      axis: z.array(z.object({ key: z.string(), title: z.string() })),
      /** Row as child, column as parent (spec 04 §3). */
      cells: z.array(z.object({ from: z.string(), to: z.string(), relationships: z.array(z.string()) })),
      legend: z.array(z.object({ initials: z.string(), relationship: z.string() })),
    }),
    refusal,
  ]),
  handler: async ({ params, body }) => {
    const result = await runDependencyMatrixUseCase({ spaceKey: params.spaceKey, query: body.query });
    if (!result.ok && 'errors' in result) queryProblem(result.errors);
    if (!result.ok) {
      const { reason, population, axisCap, cellCap, message } = result.refusal;
      return { ok: false as const, refusal: { reason, population, axisCap, cellCap, message } };
    }
    return {
      ok: true as const,
      population: result.population,
      axis: result.grid.axis,
      // The grid keys its cells as `from\0to`; JSON has no Map, so the API flattens it.
      cells: [...result.grid.cells.entries()].map(([id, relationships]) => {
        const [from = '', to = ''] = id.split('\u0000');
        return { from, to, relationships };
      }),
      legend: result.grid.legend,
    };
  },
});

export const coverage = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/coverage',
  tag: TAG,
  summary: 'Coverage counts and percentages per relationship and direction (needs EXPORT)',
  params: spaceParams,
  body: z.object({ query: z.string().max(4_000) }),
  response: z.union([
    z.object({
      ok: z.literal(true),
      population: z.number().int(),
      rows: z.array(z.looseObject({ relationship: z.string().nullable(), direction: z.string(), covered: z.number(), percent: z.number() })),
      collisions: z.array(z.unknown()),
    }),
    refusal,
  ]),
  handler: async ({ params, body }) => {
    const result = await runCoverageUseCase({ spaceKey: params.spaceKey, query: body.query });
    if (!result.ok && 'errors' in result) queryProblem(result.errors);
    if (!result.ok) {
      const { reason, population, axisCap, cellCap, message } = result.refusal;
      return { ok: false as const, refusal: { reason, population, axisCap, cellCap, message } };
    }
    return { ok: true as const, population: result.population, rows: result.rows, collisions: result.collisions };
  },
});

export const diff = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/diff',
  tag: TAG,
  summary: 'Classify requirements across two RQL queries (a DiffRequest)',
  params: spaceParams,
  body: z.looseObject({ left: z.string(), right: z.string() }),
  response: z.object({
    rows: z.array(z.looseObject({ key: z.string(), kind: z.enum(['added', 'removed', 'modified', 'unchanged']) })),
    summary: z.record(z.string(), z.number()),
    total: z.number().int(),
    warnings: z.array(rqlDiagnostic),
  }),
  handler: async ({ params, body }) => {
    const result = await runDiff({ spaceKey: params.spaceKey, request: body });
    if (!result.ok) queryProblem(result.errors);
    return { rows: result.outcome.rows, summary: result.outcome.summary, total: result.outcome.total, warnings: result.warnings };
  },
});

export const exports = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/exports',
  tag: TAG,
  summary: 'Queue an xlsx export — returns a job (needs EXPORT)',
  status: 202,
  params: spaceParams,
  body: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('traceability'), format: z.literal('xlsx').default('xlsx'), name: z.string().max(120).optional(), config: z.looseObject({ query: z.string() }) }),
    z.object({ kind: z.literal('dependencies'), format: z.literal('xlsx').default('xlsx'), query: z.string().min(1).max(4_000) }),
    z.object({ kind: z.literal('diff'), format: z.literal('xlsx').default('xlsx'), request: z.looseObject({ left: z.string(), right: z.string() }) }),
  ]),
  response: accepted,
  handler: async ({ params, body }) => {
    switch (body.kind) {
      case 'traceability':
        return { job: jobView(await exportMatrixUseCase({ spaceKey: params.spaceKey, name: body.name, config: body.config })) };
      case 'dependencies':
        return { job: jobView(await exportDependencyMatrixUseCase({ spaceKey: params.spaceKey, query: body.query })) };
      case 'diff':
        return { job: jobView(await exportDiffUseCase({ spaceKey: params.spaceKey, request: body.request })) };
      default:
        throw new ValidationError('Unknown export kind.');
    }
  },
});

export const analysisRoutes = [validateQuery, traceability, dependencies, coverage, diff, exports];
