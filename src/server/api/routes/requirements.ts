import { z } from 'zod/v4';
import { NotFoundError } from '@/domain/errors';
import { definitionByNameForApi, setValueUseCase } from '@/server/usecases/external-properties';
import {
  listRequirementsForApi,
  requirementForApi,
  requirementHistoryForApi,
  requirementIdForApi,
} from '@/server/usecases/api';
import { cursorSchema, decodeCursor, encodeCursor, limitSchema } from '../cursor';
import { defineRoute } from '../define-route';
import { expandSchema, requirement, requirementKey, rqlDiagnostic, spaceKey, spaceParams } from '../schemas';

/** spec: 08-api-surface.md §2 — requirements. Deliberately no create, update or delete. */

const TAG = 'Requirements';
const keyParams = z.object({ spaceKey, key: requirementKey });

export const listRequirements = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/requirements',
  tag: TAG,
  summary: 'List or query requirements (RQL in `q`), a page at a time',
  params: spaceParams,
  query: z.object({
    q: z.string().max(4_000).optional(),
    baseline: z.coerce.number().int().positive().optional(),
    limit: limitSchema,
    cursor: cursorSchema,
    expand: expandSchema,
  }),
  response: z.object({
    items: z.array(requirement),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    reading: z.string(),
    warnings: z.array(rqlDiagnostic),
  }),
  handler: async ({ params, query }) => {
    const after = decodeCursor(query.cursor);
    const page = await listRequirementsForApi({
      spaceKey: params.spaceKey,
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.baseline !== undefined ? { baseline: query.baseline } : {}),
      limit: query.limit,
      ...(after ? { after } : {}),
      expand: query.expand,
    });
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      reading: page.reading,
      warnings: page.warnings,
    };
  },
});

export const getRequirement = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/requirements/{key}',
  tag: TAG,
  summary: 'One requirement, live or as frozen in a baseline',
  params: keyParams,
  query: z.object({
    baseline: z.union([z.literal('current'), z.coerce.number().int().positive()]).default('current'),
    expand: expandSchema,
  }),
  response: requirement,
  handler: async ({ params, query }) =>
    requirementForApi({ spaceKey: params.spaceKey, key: params.key, baseline: query.baseline, expand: query.expand }),
});

export const requirementHistory = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/requirements/{key}/history',
  tag: TAG,
  summary: 'Change history of a requirement (spec 05 §6), newest first',
  params: keyParams,
  query: z.object({ limit: limitSchema }),
  response: z.object({
    enabled: z.boolean(),
    items: z.array(
      z.object({ at: z.string(), actorId: z.string(), changeKind: z.string(), before: z.unknown(), after: z.unknown() }),
    ),
  }),
  handler: async ({ params, query }) => requirementHistoryForApi({ spaceKey: params.spaceKey, key: params.key, limit: query.limit }),
});

export const patchExternalProperties = defineRoute({
  method: 'PATCH',
  path: '/spaces/{spaceKey}/requirements/{key}/external-properties',
  tag: TAG,
  summary: 'Set or clear external property values — the only write path to a requirement',
  params: keyParams,
  body: z.object({
    /** Property name → value; `null` clears. */
    values: z.record(z.string().min(1).max(64), z.union([z.string().max(4_000), z.number(), z.boolean(), z.null()])),
  }),
  response: z.object({ key: z.string(), updated: z.array(z.string()) }),
  handler: async ({ params, body }) => {
    const requirementId = await requirementIdForApi(params.spaceKey, params.key);
    const updated: string[] = [];
    for (const [name, raw] of Object.entries(body.values)) {
      const definition = await definitionByNameForApi(params.spaceKey, name);
      if (!definition) throw new NotFoundError(`There is no external property called “${name}”.`);
      await setValueUseCase({
        spaceKey: params.spaceKey,
        requirementId,
        definitionId: definition.id,
        value: raw === null ? null : String(raw),
      });
      updated.push(definition.name);
    }
    return { key: params.key, updated };
  },
});

export const requirementRoutes = [listRequirements, getRequirement, requirementHistory, patchExternalProperties];
