import { registerJobHandlers } from '../src/server/jobs/register';
import { drainQueue } from '../src/server/jobs/runner';

/**
 * The job worker as its own process: `pnpm worker`.
 * The web process also runs queued jobs, and `claimNextJob` uses FOR UPDATE SKIP LOCKED,
 * so running both is safe.
 */
const INTERVAL_MS = Number(process.env.JOB_POLL_MS ?? 2000);

async function main(): Promise<void> {
  registerJobHandlers();
  console.log(`Reqforge worker started, polling every ${INTERVAL_MS}ms.`);

  let running = true;
  const stop = () => {
    running = false;
    console.log('Worker stopping after the current job.');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    const ran = await drainQueue();
    if (ran === 0) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
