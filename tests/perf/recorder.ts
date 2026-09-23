import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Collects the measurements of one perf run and writes them for the gate
 * (`scripts/perf-gate.ts`). spec: 07-permissions-and-limits.md §5; RD-073.
 */
export type Measurement = {
  operation: string;
  budgetMs: number;
  p95Ms: number;
  /**
   * What the regression gate compares (RD-073). A p95 over a few dozen runs is one or two
   * GC pauses or autovacuum passes; between identical runs it moved by ±40% here, which a
   * 25% gate cannot tolerate. The median moved by under 5%.
   */
  medianMs: number;
  runs: number;
  /** Every timing, sorted, so a surprising p95 can be read against its neighbours. */
  timingsMs: number[];
};

export const RESULTS_PATH = resolve(process.cwd(), 'perf-results.json');

const measurements: Measurement[] = [];

export function median(timings: readonly number[]): number {
  const sorted = [...timings].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** p95 as the suite has always taken it: the ceil(0.95·n)-th fastest run. */
export function p95(timings: readonly number[]): number {
  const sorted = [...timings].sort((a, b) => a - b);
  return sorted[Math.max(Math.ceil(sorted.length * 0.95) - 1, 0)]!;
}

/**
 * Runs `fn` `warmups` times unmeasured, then `runs` times measured, and records the p95.
 * `fn` may return a check that throws when the operation did not really succeed, so a
 * failure can never pass as a fast result.
 */
export async function measure(
  operation: string,
  budgetMs: number,
  fn: (run: number) => Promise<void>,
  options: { runs?: number; warmups?: number } = {},
): Promise<Measurement> {
  const runs = options.runs ?? 30;
  const warmups = options.warmups ?? 5;
  for (let run = 0; run < warmups; run += 1) await fn(-1 - run);
  const timings: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    await fn(run);
    timings.push(performance.now() - started);
  }
  const measurement: Measurement = {
    operation,
    budgetMs,
    p95Ms: Math.round(p95(timings) * 10) / 10,
    medianMs: Math.round(median(timings) * 10) / 10,
    runs,
    timingsMs: [...timings].sort((a, b) => a - b).map((value) => Math.round(value * 10) / 10),
  };
  measurements.push(measurement);
  console.log(`  ${operation}: p95 ${measurement.p95Ms} ms of ${budgetMs} ms, median ${measurement.medianMs} ms (${runs} runs)`);
  return measurement;
}

export function writeResults(meta: Record<string, unknown>): void {
  writeFileSync(RESULTS_PATH, `${JSON.stringify({ ...meta, measurements }, null, 2)}\n`);
}
