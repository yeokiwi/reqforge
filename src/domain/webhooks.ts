/**
 * Webhooks, the pure part. spec: 08-api-surface.md §7; RD-066 (thin payloads), RD-067
 * (retry schedule, dead letter). The signature lives in `webhook-signature.ts`, because this
 * module is also imported by a client component and must not pull in `node:crypto`.
 */
export const WEBHOOK_EVENTS = [
  'requirement.created',
  'requirement.updated',
  'requirement.deleted',
  'requirement.renamed',
  'dependency.changed',
  'validation.failed',
  'baseline.frozen',
  'document.indexed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * RD-066 — identifiers only. A consumer that wants the text fetches it through the API
 * with its own token, which applies rule X3; nothing restricted ever leaves in a push.
 */
export type WebhookPayload = {
  id: string;
  type: WebhookEventType;
  space: string;
  /** `SPACE/KEY/current` or `SPACE/KEY/<baseline>` (spec 05 §4). Absent for document events. */
  recordId: string | null;
  key: string | null;
  actorId: string;
  occurredAt: string;
  /** Identifiers only: previousKey, baselineNumber, documentId, versionNumber, typeId. */
  data: Record<string, string | number | null>;
};

/**
 * Attempt n (1-based) failed; when is the next? +1 min, 5 min, 30 min, 2 h, 12 h, then the
 * delivery is dead (RD-067). Six attempts over about fourteen and a half hours.
 */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export function nextAttemptAfter(attempt: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attempt - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}
