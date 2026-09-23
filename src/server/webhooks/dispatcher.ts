import { deliverDueWebhooks } from './deliver';

/**
 * Keeps webhook deliveries moving in whichever process is running: the web server and
 * `pnpm worker` both start it, and `claimDueDeliveries` uses `FOR UPDATE SKIP LOCKED`, so
 * running both is safe. Not started under test, where deliveries are driven explicitly.
 */
const INTERVAL_MS = Number(process.env.WEBHOOK_POLL_MS ?? 5_000);
let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startWebhookDispatcher(): void {
  if (timer || process.env.NODE_ENV === 'test' || process.env.WEBHOOKS_DISABLED === '1') return;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    deliverDueWebhooks()
      .catch((error: unknown) => console.error('[webhooks]', error))
      .finally(() => {
        busy = false;
      });
  }, INTERVAL_MS);
  timer.unref();
}
