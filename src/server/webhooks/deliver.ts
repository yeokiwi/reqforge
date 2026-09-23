import { signPayload } from '@/domain/webhook-signature';
import { nextAttemptAfter } from '@/domain/webhooks';
import { checkUrl, defaultResolver, type Fetcher, type Resolver } from '@/server/images/fetch';
import { claimDueDeliveries, recordAttempt } from '@/server/repositories/webhooks';

/**
 * Sends due webhook deliveries. spec: 08-api-surface.md §7 — "HMAC-signed, with delivery
 * retry and a dead-letter view"; RD-067.
 *
 * Each attempt:
 *   - runs the slice-13 SSRF guard again (`checkUrl`): DNS can change between the day a
 *     subscription was checked and the day it fires;
 *   - never follows a redirect, which would be a way round that guard;
 *   - times out after 10 s;
 *   - counts only a 2xx as delivered.
 */
export const DELIVERY_TIMEOUT_MS = 10_000;
export const DELIVERY_BATCH = 50;

export type DeliveryOptions = {
  now?: () => Date;
  fetcher?: Fetcher;
  resolver?: Resolver;
  limit?: number;
};

export type DeliveryReport = { attempted: number; delivered: number; retrying: number; dead: number };

export async function deliverDueWebhooks(options: DeliveryOptions = {}): Promise<DeliveryReport> {
  const now = options.now ?? (() => new Date());
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const resolver = options.resolver ?? defaultResolver;
  const report: DeliveryReport = { attempted: 0, delivered: 0, retrying: 0, dead: 0 };

  const due = await claimDueDeliveries(now(), options.limit ?? DELIVERY_BATCH);
  for (const delivery of due) {
    report.attempted += 1;
    const attempt = delivery.attempt + 1;
    const body = JSON.stringify(delivery.payload);

    let status: number | null = null;
    let error: string | null = null;

    const checked = await checkUrl(delivery.url, resolver);
    if (!checked.ok) {
      error = `Refused: ${checked.reason}`;
    } else {
      const timestamp = String(Math.floor(now().getTime() / 1000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      try {
        const response = await fetcher(checked.url.toString(), {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Reqforge-Webhooks/1',
            'X-Reqforge-Event': (delivery.payload as { type?: string }).type ?? '',
            'X-Reqforge-Delivery': delivery.id,
            'X-Reqforge-Timestamp': timestamp,
            'X-Reqforge-Signature': signPayload(delivery.secret, timestamp, body),
          },
          body,
        });
        status = response.status;
        if (status < 200 || status >= 300) error = `HTTP ${status}`;
        await response.body?.cancel().catch(() => undefined);
      } catch (caught) {
        error = controller.signal.aborted ? `Timed out after ${DELIVERY_TIMEOUT_MS / 1000} s` : caught instanceof Error ? caught.message : 'Request failed';
      } finally {
        clearTimeout(timer);
      }
    }

    const delivered = error === null;
    const state = await recordAttempt({
      id: delivery.id,
      attempt,
      delivered,
      status,
      error,
      nextAttemptAt: delivered ? null : nextAttemptAfter(attempt, now()),
      now: now(),
    });
    if (state === 'DELIVERED') report.delivered += 1;
    else if (state === 'DEAD') report.dead += 1;
    else report.retrying += 1;
  }

  return report;
}
