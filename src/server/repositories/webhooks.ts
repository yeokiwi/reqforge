import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, WebhookDeliveryState } from '@prisma/client';
import { NotFoundError } from '@/domain/errors';
import { formatRecordId } from '@/domain/record-id';
import { MAX_ATTEMPTS, type WebhookEventType, type WebhookPayload } from '@/domain/webhooks';
import { prisma } from './client';

/**
 * Webhook subscriptions, the transactional outbox, and delivery bookkeeping.
 * spec: 08-api-surface.md §7; RD-066, RD-067.
 */

export type EventInput = {
  type: WebhookEventType;
  spaceId: string;
  actorId: string;
  key?: string | null;
  baselineNumber?: number | null;
  data?: Record<string, string | number | null>;
};

/** Whether anyone listens in this space — lets the indexer skip before-images nobody reads. */
export async function hasSubscribers(tx: Prisma.TransactionClient, spaceId: string): Promise<boolean> {
  return (await tx.webhook.count({ where: { spaceId, active: true } })) > 0;
}

/**
 * RD-067 — writes events, and one delivery per matching subscription, **inside the
 * caller's transaction**: a change that rolls back emits nothing, and a change that
 * commits cannot lose its event. A space with no subscribers writes nothing at all.
 */
export async function emitEvents(tx: Prisma.TransactionClient, events: readonly EventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const spaceIds = [...new Set(events.map((event) => event.spaceId))];
  const hooks = await tx.webhook.findMany({
    where: { spaceId: { in: spaceIds }, active: true },
    select: { id: true, spaceId: true, events: true },
  });
  if (hooks.length === 0) return 0;

  const spaces = await tx.space.findMany({ where: { id: { in: spaceIds } }, select: { id: true, key: true } });
  const spaceKey = new Map(spaces.map((space) => [space.id, space.key]));
  const occurredAt = new Date().toISOString();

  const eventRows: Prisma.WebhookEventCreateManyInput[] = [];
  const deliveryRows: Prisma.WebhookDeliveryCreateManyInput[] = [];
  for (const event of events) {
    const listeners = hooks.filter(
      (hook) => hook.spaceId === event.spaceId && (hook.events.length === 0 || hook.events.includes(event.type)),
    );
    if (listeners.length === 0) continue;

    const id = randomUUID();
    const space = spaceKey.get(event.spaceId) ?? '';
    const payload: WebhookPayload = {
      id,
      type: event.type,
      space,
      recordId: event.key ? formatRecordId(space, event.key, event.baselineNumber ?? null) : null,
      key: event.key ?? null,
      actorId: event.actorId,
      occurredAt,
      data: event.data ?? {},
    };
    eventRows.push({ id, spaceId: event.spaceId, type: event.type, recordId: payload.recordId, payload });
    for (const hook of listeners) deliveryRows.push({ webhookId: hook.id, eventId: id });
  }

  if (eventRows.length === 0) return 0;
  await tx.webhookEvent.createMany({ data: eventRows });
  await tx.webhookDelivery.createMany({ data: deliveryRows });
  return eventRows.length;
}

export async function emitEventsNow(events: readonly EventInput[]): Promise<number> {
  return prisma.$transaction((tx) => emitEvents(tx, events));
}

export type DueDelivery = {
  id: string;
  attempt: number;
  url: string;
  secret: string;
  payload: Prisma.JsonValue;
};

/**
 * Claims due deliveries with `FOR UPDATE SKIP LOCKED`, as the job queue claims jobs: the
 * web process and a worker can both dispatch without sending anything twice. A claimed
 * row's `nextAttemptAt` moves five minutes ahead, so a dispatcher that dies mid-request
 * leaves it to be retried rather than stuck.
 */
export async function claimDueDeliveries(now: Date, limit: number): Promise<DueDelivery[]> {
  return prisma.$transaction(async (tx) => {
    const ids = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT d.id FROM "WebhookDelivery" d
       WHERE d.state = 'PENDING' AND d."nextAttemptAt" <= ${now}
       ORDER BY d."nextAttemptAt"
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    `;
    if (ids.length === 0) return [];
    await tx.webhookDelivery.updateMany({
      where: { id: { in: ids.map((row) => row.id) } },
      data: { nextAttemptAt: new Date(now.getTime() + 300_000) },
    });
    const rows = await tx.webhookDelivery.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: { id: true, attempt: true, webhook: { select: { url: true, secret: true, active: true } }, event: { select: { payload: true } } },
    });
    return rows
      .filter((row) => row.webhook.active)
      .map((row) => ({ id: row.id, attempt: row.attempt, url: row.webhook.url, secret: row.webhook.secret, payload: row.event.payload }));
  });
}

/** Records one attempt's outcome: delivered, retry at `nextAttemptAt`, or dead. */
export async function recordAttempt(input: {
  id: string;
  attempt: number;
  delivered: boolean;
  status: number | null;
  error: string | null;
  nextAttemptAt: Date | null;
  now: Date;
}): Promise<WebhookDeliveryState> {
  const state: WebhookDeliveryState = input.delivered ? 'DELIVERED' : input.nextAttemptAt && input.attempt < MAX_ATTEMPTS ? 'PENDING' : 'DEAD';
  await prisma.webhookDelivery.update({
    where: { id: input.id },
    data: {
      attempt: input.attempt,
      state,
      lastStatus: input.status,
      lastError: input.error?.slice(0, 500) ?? null,
      ...(state === 'DELIVERED' ? { deliveredAt: input.now } : {}),
      ...(state === 'PENDING' && input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
    },
  });
  return state;
}

// -------------------------------------------------------------- subscriptions (ADMIN)

export async function createWebhook(input: { spaceId: string; url: string; events: readonly string[]; createdById: string }) {
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const row = await prisma.webhook.create({
    data: { spaceId: input.spaceId, url: input.url, secret, events: [...input.events], createdById: input.createdById },
    select: { id: true, url: true, events: true, active: true, createdAt: true },
  });
  return { ...row, secret };
}

export async function listWebhooks(spaceId: string) {
  const hooks = await prisma.webhook.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, url: true, events: true, active: true, createdAt: true },
  });
  const counts = await prisma.webhookDelivery.groupBy({
    by: ['webhookId', 'state'],
    where: { webhookId: { in: hooks.map((hook) => hook.id) } },
    _count: { _all: true },
  });
  return hooks.map((hook) => {
    const of = (state: WebhookDeliveryState) =>
      counts.find((row) => row.webhookId === hook.id && row.state === state)?._count._all ?? 0;
    return { ...hook, pending: of('PENDING'), delivered: of('DELIVERED'), dead: of('DEAD') };
  });
}

export async function findWebhook(spaceId: string, id: string) {
  return prisma.webhook.findFirst({ where: { id, spaceId }, select: { id: true, url: true, events: true, active: true } });
}

export async function deleteWebhook(spaceId: string, id: string): Promise<void> {
  const removed = await prisma.webhook.deleteMany({ where: { id, spaceId } });
  if (removed.count === 0) throw new NotFoundError('That webhook does not exist.');
}

export async function listDeliveries(spaceId: string, webhookId: string, state: WebhookDeliveryState | undefined, limit: number) {
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhookId, webhook: { spaceId }, ...(state ? { state } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      state: true,
      attempt: true,
      lastStatus: true,
      lastError: true,
      nextAttemptAt: true,
      deliveredAt: true,
      createdAt: true,
      event: { select: { type: true, recordId: true } },
    },
  });
  return rows;
}

/** The dead-letter view's action: send a dead delivery again, from attempt one. */
export async function redeliver(spaceId: string, deliveryId: string, now: Date): Promise<void> {
  const updated = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, state: 'DEAD', webhook: { spaceId } },
    data: { state: 'PENDING', attempt: 0, nextAttemptAt: now, lastError: null },
  });
  if (updated.count === 0) throw new NotFoundError('There is no dead delivery with that id.');
}
