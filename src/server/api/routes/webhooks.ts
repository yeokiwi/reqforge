import { z } from 'zod/v4';
import { WEBHOOK_EVENTS } from '@/domain/webhooks';
import {
  createWebhookUseCase,
  deleteWebhookUseCase,
  listDeliveriesUseCase,
  listWebhooksUseCase,
  redeliverUseCase,
} from '@/server/usecases/webhooks';
import { limitSchema } from '../cursor';
import { defineRoute } from '../define-route';
import { spaceKey, spaceParams } from '../schemas';

/** spec: 08-api-surface.md §7 — webhooks, per space, for space ADMIN. */

const TAG = 'Webhooks';
const hookParams = z.object({ spaceKey, id: z.string().min(1).max(64) });

const webhook = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string(),
  pending: z.number().int(),
  delivered: z.number().int(),
  dead: z.number().int(),
});

export const listHooks = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/webhooks',
  tag: TAG,
  summary: 'Webhook subscriptions of a space, with delivery counts',
  params: spaceParams,
  response: z.object({ items: z.array(webhook) }),
  handler: async ({ params }) => ({
    items: (await listWebhooksUseCase(params.spaceKey)).map((hook) => ({ ...hook, createdAt: hook.createdAt.toISOString() })),
  }),
});

export const createHook = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/webhooks',
  tag: TAG,
  summary: 'Subscribe a URL; the signing secret is returned once',
  status: 201,
  params: spaceParams,
  body: z.object({ url: z.string().url().max(2_000), events: z.array(z.enum(WEBHOOK_EVENTS)).default([]) }),
  response: z.object({ id: z.string(), url: z.string(), events: z.array(z.string()), secret: z.string() }),
  handler: async ({ params, body }) => {
    const created = await createWebhookUseCase(params.spaceKey, { url: body.url, events: body.events });
    return { id: created.id, url: created.url, events: created.events, secret: created.secret };
  },
});

export const deleteHook = defineRoute({
  method: 'DELETE',
  path: '/spaces/{spaceKey}/webhooks/{id}',
  tag: TAG,
  summary: 'Remove a subscription and its pending deliveries',
  status: 204,
  params: hookParams,
  response: z.null(),
  handler: async ({ params }) => {
    await deleteWebhookUseCase(params.spaceKey, params.id);
    return null;
  },
});

export const listHookDeliveries = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/webhooks/{id}/deliveries',
  tag: TAG,
  summary: 'Recent deliveries; `?state=DEAD` is the dead-letter view',
  params: hookParams,
  query: z.object({ state: z.enum(['PENDING', 'DELIVERED', 'DEAD']).optional(), limit: limitSchema }),
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        state: z.enum(['PENDING', 'DELIVERED', 'DEAD']),
        attempt: z.number().int(),
        lastStatus: z.number().int().nullable(),
        lastError: z.string().nullable(),
        nextAttemptAt: z.string().nullable(),
        deliveredAt: z.string().nullable(),
        type: z.string(),
        recordId: z.string().nullable(),
      }),
    ),
  }),
  handler: async ({ params, query }) => {
    const rows = await listDeliveriesUseCase(params.spaceKey, params.id, query.state, query.limit);
    return {
      items: rows.map((row) => ({
        id: row.id,
        state: row.state,
        attempt: row.attempt,
        lastStatus: row.lastStatus,
        lastError: row.lastError,
        nextAttemptAt: row.state === 'PENDING' ? row.nextAttemptAt.toISOString() : null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        type: row.event.type,
        recordId: row.event.recordId,
      })),
    };
  },
});

export const redeliverHook = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/webhooks/deliveries/{id}/redeliver',
  tag: TAG,
  summary: 'Send a dead delivery again, from its first attempt',
  status: 202,
  params: hookParams,
  response: z.object({ id: z.string(), state: z.literal('PENDING') }),
  handler: async ({ params }) => {
    await redeliverUseCase(params.spaceKey, params.id);
    return { id: params.id, state: 'PENDING' as const };
  },
});

export const webhookRoutes = [listHooks, createHook, deleteHook, listHookDeliveries, redeliverHook];
