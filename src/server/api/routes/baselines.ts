import { z } from 'zod/v4';
import { baselineIdByNumber, pinnedDocumentsForApi } from '@/server/usecases/api';
import {
  baselineDetailUseCase,
  createBaselineUseCase,
  deleteBaselineUseCase,
  freezeUseCase,
  listBaselinesUseCase,
  refreezeUseCase,
  renameBaselineUseCase,
} from '@/server/usecases/baselines';
import { defineRoute } from '../define-route';
import { accepted, jobView, spaceKey, spaceParams } from '../schemas';

/** spec: 08-api-surface.md §4 — baselines. */

const TAG = 'Baselines';
const numberParams = z.object({ spaceKey, number: z.coerce.number().int().positive() });

const baseline = z.object({
  number: z.number().int(),
  name: z.string(),
  state: z.enum(['DRAFT', 'FROZEN']),
  sourceQuery: z.string(),
  frozenAt: z.string().nullable(),
  memberCount: z.number().int(),
  details: z
    .object({
      dangling: z.number().int(),
      revisions: z.number().int(),
      classification: z.string().nullable(),
      reportDocumentId: z.string().nullable(),
    })
    .optional(),
});

type BaselineRow = { number: number; name: string; state: 'DRAFT' | 'FROZEN'; sourceQuery: string; frozenAt: Date | null };
const view = (row: BaselineRow, memberCount: number) => ({
  number: row.number,
  name: row.name,
  state: row.state,
  sourceQuery: row.sourceQuery,
  frozenAt: row.frozenAt?.toISOString() ?? null,
  memberCount,
});

export const listBaselines = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/baselines',
  tag: TAG,
  summary: 'Baselines of a space; `?expand=details` adds dangling, revisions and label',
  params: spaceParams,
  query: z.object({ expand: z.enum(['details']).optional() }),
  response: z.object({ items: z.array(baseline), total: z.number().int() }),
  handler: async ({ params, query }) => {
    const rows = await listBaselinesUseCase(params.spaceKey);
    const items = await Promise.all(
      rows.map(async (row) => {
        if (query.expand !== 'details') return view(row, row.memberCount);
        const detail = await baselineDetailUseCase(params.spaceKey, row.number);
        return {
          ...view(row, row.memberCount),
          details: {
            dangling: detail.dangling.length,
            revisions: detail.revisions.length,
            classification: detail.classification,
            reportDocumentId: detail.reportDocumentId,
          },
        };
      }),
    );
    return { items, total: items.length };
  },
});

export const createBaseline = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/baselines',
  tag: TAG,
  summary: 'Create a DRAFT baseline over an RQL query',
  status: 201,
  params: spaceParams,
  body: z.object({
    name: z.string().min(1).max(120),
    query: z.string().min(1).max(4_000),
    reportDocumentId: z.string().max(64).nullable().optional(),
    includeParentDependencies: z.boolean().optional(),
  }),
  response: baseline,
  handler: async ({ params, body }) => {
    const created = await createBaselineUseCase({
      spaceKey: params.spaceKey,
      name: body.name,
      query: body.query,
      includeParentDependencies: body.includeParentDependencies === true,
      reportDocumentId: body.reportDocumentId ?? null,
    });
    return view(created, 0);
  },
});

export const freezeBaseline = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/baselines/{number}/freeze',
  tag: TAG,
  summary: 'Freeze a DRAFT — returns a job',
  status: 202,
  params: numberParams,
  response: accepted,
  handler: async ({ params }) => {
    const id = await baselineIdByNumber(params.spaceKey, params.number);
    return { job: jobView(await freezeUseCase({ spaceKey: params.spaceKey, id })) };
  },
});

export const refreezeBaseline = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/baselines/{number}/refreeze',
  tag: TAG,
  summary: 'Refreeze a FROZEN baseline, optionally with a new query — returns a job',
  status: 202,
  params: numberParams,
  body: z.object({ query: z.string().max(4_000).optional(), reason: z.string().min(1).max(2_000) }),
  response: accepted,
  handler: async ({ params, body }) => {
    const id = await baselineIdByNumber(params.spaceKey, params.number);
    return {
      job: jobView(
        await refreezeUseCase({
          spaceKey: params.spaceKey,
          id,
          reason: body.reason,
          ...(body.query !== undefined ? { query: body.query } : {}),
        }),
      ),
    };
  },
});

export const renameBaseline = defineRoute({
  method: 'PATCH',
  path: '/spaces/{spaceKey}/baselines/{number}',
  tag: TAG,
  summary: 'Rename a baseline (its number never changes)',
  params: numberParams,
  body: z.object({ name: z.string().min(1).max(120) }),
  response: baseline,
  handler: async ({ params, body }) => {
    const id = await baselineIdByNumber(params.spaceKey, params.number);
    const renamed = await renameBaselineUseCase(params.spaceKey, id, body.name);
    const detail = await baselineDetailUseCase(params.spaceKey, params.number);
    return view(renamed, detail.memberCount);
  },
});

export const deleteBaseline = defineRoute({
  method: 'DELETE',
  path: '/spaces/{spaceKey}/baselines/{number}',
  tag: TAG,
  summary: 'Delete a baseline (space ADMIN); its number is never reused',
  status: 204,
  params: numberParams,
  response: z.null(),
  handler: async ({ params }) => {
    const id = await baselineIdByNumber(params.spaceKey, params.number);
    await deleteBaselineUseCase(params.spaceKey, id);
    return null;
  },
});

export const baselineDocuments = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/baselines/{number}/documents',
  tag: TAG,
  summary: 'The document versions a baseline pinned',
  params: numberParams,
  response: z.object({
    items: z.array(
      z.object({ documentId: z.string(), documentTitle: z.string(), versionId: z.string(), versionNumber: z.number().int() }),
    ),
  }),
  handler: async ({ params }) => ({ items: await pinnedDocumentsForApi(params.spaceKey, params.number) }),
});

export const baselineRoutes = [
  listBaselines,
  createBaseline,
  freezeBaseline,
  refreezeBaseline,
  renameBaseline,
  deleteBaseline,
  baselineDocuments,
];
