import type { WebhookDeliveryState } from '@prisma/client';
import { NotFoundError, ValidationError } from '@/domain/errors';
import { isWebhookEvent } from '@/domain/webhooks';
import { requireSpace } from '@/server/authz';
import { checkUrl, defaultResolver, type Resolver } from '@/server/images/fetch';
import { recordAuditEvent } from '@/server/repositories/audit';
import {
  createWebhook,
  deleteWebhook,
  findWebhook,
  listDeliveries,
  listWebhooks,
  redeliver,
} from '@/server/repositories/webhooks';

/**
 * Webhook subscriptions. spec: 08-api-surface.md §7 — "Outbound, per space, HMAC-signed,
 * with delivery retry and a dead-letter view." Space ADMIN, audited (spec 07 §6).
 */

let resolver: Resolver = defaultResolver;
/** Tests only: no test here reaches a real resolver. */
export function setWebhookResolver(next: Resolver): void {
  resolver = next;
}

/**
 * A URL is checked when the subscription is made as well as at every delivery. At creation
 * a host that resolves to a private address is refused outright; one that does not resolve
 * *yet* is allowed, because DNS for a new receiver often lags the form that registers it,
 * and delivery re-checks anyway.
 */
async function checkedUrl(raw: unknown): Promise<string> {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 2_000) {
    throw new ValidationError('A webhook needs an http(s) URL.');
  }
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('That is not a URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('A webhook URL must be http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError('Put credentials in your receiver`s check of the signature, not in the URL.');
  }
  const checked = await checkUrl(url, resolver);
  if (!checked.ok && !/could not be resolved|resolved to no addresses/.test(checked.reason)) {
    throw new ValidationError(`That URL cannot receive webhooks: ${checked.reason}`);
  }
  return url;
}

function cleanEvents(raw: readonly unknown[]): string[] {
  const unknown = raw.filter((event) => !isWebhookEvent(event));
  if (unknown.length > 0) throw new ValidationError(`Unknown event type: ${unknown.join(', ')}.`);
  return [...new Set(raw as string[])];
}

export async function listWebhooksUseCase(spaceKey: string) {
  const { space } = await requireSpace(spaceKey, 'ADMIN');
  return listWebhooks(space.id);
}

/** Returns the signing secret once; it is never shown again. */
export async function createWebhookUseCase(spaceKey: string, input: { url: unknown; events: readonly unknown[] }) {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const url = await checkedUrl(input.url);
  const events = cleanEvents(input.events);
  const created = await createWebhook({ spaceId: space.id, url, events, createdById: user.id });
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Webhook',
    objectId: created.id,
    operation: 'create',
    parameters: { url, events },
  });
  return created;
}

export async function deleteWebhookUseCase(spaceKey: string, id: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const hook = await findWebhook(space.id, id);
  if (!hook) throw new NotFoundError('That webhook does not exist.');
  await deleteWebhook(space.id, id);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Webhook',
    objectId: id,
    operation: 'delete',
    parameters: { url: hook.url },
  });
}

export async function listDeliveriesUseCase(
  spaceKey: string,
  webhookId: string,
  state?: WebhookDeliveryState,
  limit = 100,
) {
  const { space } = await requireSpace(spaceKey, 'ADMIN');
  if (!(await findWebhook(space.id, webhookId))) throw new NotFoundError('That webhook does not exist.');
  return listDeliveries(space.id, webhookId, state, limit);
}

/** The dead-letter view's action (RD-067). */
export async function redeliverUseCase(spaceKey: string, deliveryId: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  await redeliver(space.id, deliveryId, new Date());
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'WebhookDelivery',
    objectId: deliveryId,
    operation: 'redeliver',
    parameters: {},
  });
}
