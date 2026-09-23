/**
 * Runs once when the Next.js server starts. Starts webhook delivery in the web process
 * (spec 08 §7), so deliveries move even when no job has been queued since boot.
 *
 * The import sits inside the `nodejs` branch, not after an early return: that is the form
 * Next's bundler strips from the edge build, which cannot resolve `node:dns` or `node:net`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWebhookDispatcher } = await import('./server/webhooks/dispatcher');
    startWebhookDispatcher();
  }
}
