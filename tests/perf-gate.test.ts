import { describe, expect, it } from 'vitest';
import { judge, REGRESSION_TOLERANCE } from '../scripts/perf-gate';

/** spec 07 §5 — "CI fails on a >25% regression against the recorded baseline". RD-073. */
describe('the performance gate', () => {
  const m = (p95Ms: number, medianMs: number) => ({ operation: 'search-simple-100', budgetMs: 150, p95Ms, medianMs });

  it('is 25%, as the spec says', () => {
    expect(REGRESSION_TOLERANCE).toBe(0.25);
  });

  it('passes inside the budget and within 25% of the baseline', () => {
    expect(judge([m(140, 62)], { 'search-simple-100': 50 })).toEqual([]);
  });

  it('fails a p95 over the budget whatever the baseline, naming the operation and both numbers', () => {
    expect(judge([m(151, 40)], undefined)).toEqual(['search-simple-100: p95 151 ms is over its budget of 150 ms (spec 07 §5).']);
  });

  it('fails a median more than 25% over the baseline even inside the budget', () => {
    const failures = judge([m(120, 63)], { 'search-simple-100': 50 });
    expect(failures).toEqual(['search-simple-100: median 63 ms is 26% over the recorded baseline of 50 ms (limit +25%).']);
  });

  it('applies only the budget to an operation with no recorded baseline', () => {
    expect(judge([m(140, 500)], { other: 1 })).toEqual([]);
  });
});
