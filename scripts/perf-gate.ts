import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The performance gate. spec: 07-permissions-and-limits.md §5 — "CI fails on a >25%
 * regression against the recorded baseline for any of these." RD-073.
 *
 * Reads `perf-results.json` (written by `pnpm perf`'s suite) and `tests/perf/baseline.json`,
 * keyed by environment (`PERF_ENV`, default `local`), because a time recorded on one machine
 * says nothing about another. For each operation it fails when:
 *   - the p95 is over the spec's absolute budget (spec 07 §5 states the budgets as p95), or
 *   - the median is more than 25% over this environment's recorded median. The spec names
 *     no statistic for the regression; the median is the one stable enough to hold a 25%
 *     line between identical runs (RD-073).
 * With no baseline for the environment only the budgets apply, and it says how to record.
 *
 *   pnpm perf            measure and gate
 *   pnpm perf:record     measure, gate on the budgets, and record this environment's baseline
 */
type Measurement = { operation: string; budgetMs: number; p95Ms: number; medianMs: number };
type Baselines = Record<string, { recordedAt: string; medianMs?: Record<string, number>; p95Ms: Record<string, number> }>;

export const REGRESSION_TOLERANCE = 0.25;

export function judge(
  measurements: readonly Measurement[],
  baseline: Record<string, number> | undefined,
): string[] {
  const failures: string[] = [];
  for (const m of measurements) {
    if (m.p95Ms > m.budgetMs) {
      failures.push(`${m.operation}: p95 ${m.p95Ms} ms is over its budget of ${m.budgetMs} ms (spec 07 §5).`);
    }
    const recorded = baseline?.[m.operation];
    if (recorded !== undefined && m.medianMs > recorded * (1 + REGRESSION_TOLERANCE)) {
      const percent = Math.round((m.medianMs / recorded - 1) * 100);
      failures.push(
        `${m.operation}: median ${m.medianMs} ms is ${percent}% over the recorded baseline of ${recorded} ms (limit +${REGRESSION_TOLERANCE * 100}%).`,
      );
    }
  }
  return failures;
}

function main(): void {
  const root = process.cwd();
  const resultsPath = resolve(root, 'perf-results.json');
  const baselinePath = resolve(root, 'tests/perf/baseline.json');
  const environment = process.env.PERF_ENV ?? 'local';
  const record = process.argv.includes('--record');

  if (!existsSync(resultsPath)) {
    console.error('perf-gate: no perf-results.json — run the perf suite first (pnpm perf).');
    process.exit(1);
  }
  const { measurements } = JSON.parse(readFileSync(resultsPath, 'utf8')) as { measurements: Measurement[] };
  const baselines: Baselines = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Baselines) : {};
  const recorded = baselines[environment];

  console.log(`perf-gate: environment "${environment}", ${recorded ? `baseline of ${recorded.recordedAt}` : 'no recorded baseline'}`);
  for (const m of measurements) {
    const was = recorded?.medianMs?.[m.operation];
    console.log(
      `  ${m.operation.padEnd(22)} p95 ${String(m.p95Ms).padStart(8)} ms of ${String(m.budgetMs).padStart(6)}   median ${String(m.medianMs).padStart(8)} ms${
        was !== undefined ? ` vs baseline ${was} ms (${m.medianMs >= was ? '+' : ''}${Math.round((m.medianMs / was - 1) * 100)}%)` : ''
      }`,
    );
  }

  // Recording never excuses a blown budget, and never compares against the baseline it is
  // about to replace.
  const failures = judge(measurements, record ? undefined : recorded?.medianMs);
  if (failures.length > 0) {
    console.error('\nperf-gate: FAILED');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  if (record) {
    baselines[environment] = {
      recordedAt: new Date().toISOString(),
      medianMs: Object.fromEntries(measurements.map((m) => [m.operation, m.medianMs])),
      p95Ms: Object.fromEntries(measurements.map((m) => [m.operation, m.p95Ms])),
    };
    writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
    console.log(`perf-gate: recorded the "${environment}" baseline in tests/perf/baseline.json — commit it.`);
    return;
  }
  if (!recorded) {
    console.log(`perf-gate: budgets met. No "${environment}" baseline to compare against; record one with PERF_ENV=${environment} pnpm perf:record.`);
    return;
  }
  console.log('perf-gate: passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/perf-gate.ts')) main();
