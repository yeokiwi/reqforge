import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAndAnalyse } from '@/domain/ryql';
import { prisma } from '@/server/repositories/client';
import { runSearch, visibilityPredicate } from '@/server/repositories/search';
import { runMatrixForUser } from '@/server/usecases/matrix';
import { createCorpusSpace, dropCorpusSpace, type FixtureHandles } from './fixtures/corpus-space';

/**
 * spec: 07-permissions-and-limits.md §5 — the performance budget, measured on the fixture
 * dataset. Slice 18 adds the >25% regression gate against a recorded baseline; this is the
 * absolute budget, which must hold from the day the compiler ships.
 *
 * Set SKIP_PERF=1 to skip on a machine that is too loaded to measure anything.
 */
const budgets = [
  { name: 'search, 100 rows, simple query', query: "@Category = 'Safety'", budgetMs: 150 },
  { name: 'search, 100 rows, one traversal', query: "to -> @Category = 'Safety'", budgetMs: 400 },
];

let fixture: FixtureHandles;

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
  await prisma.$executeRawUnsafe('ANALYZE "Requirement"');
  await prisma.$executeRawUnsafe('ANALYZE "Property"');
}, 120_000);

afterAll(async () => {
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

async function p95(query: string, runs = 20, warmups = 3): Promise<number> {
  const analysed = parseAndAnalyse(query, { spaceKey: fixture.spaceKey, isolated: false });
  if (!analysed.ok) throw new Error(analysed.errors.map((error) => error.message).join('; '));
  const visibility = visibilityPredicate(fixture.userId, []);

  // The first call pays for the connection, the plan and a cold cache. A budget is about
  // steady state, so those runs are excluded rather than allowed to become the p95.
  for (let run = 0; run < warmups; run += 1) {
    await runSearch(analysed.query.expr, { visibility, limit: 100 });
  }

  const timings: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    await runSearch(analysed.query.expr, { visibility, limit: 100 });
    timings.push(performance.now() - started);
  }

  timings.sort((a, b) => a - b);
  return timings[Math.max(Math.ceil(runs * 0.95) - 1, 0)]!;
}

/** The eight columns of the spec 07 §5 line "matrix page, 100 rows, 8 columns". */
const MATRIX_COLUMNS = [
  { kind: 'key' },
  { kind: 'title' },
  { kind: 'status' },
  { kind: 'document' },
  { kind: 'property', name: 'Category' },
  { kind: 'property', name: 'Priority' },
  { kind: 'external', name: 'Approval' },
  { kind: 'dependency', direction: 'to', relationship: 'refines', depth: 1, render: 'key' },
];

async function matrixP95(runs = 10, warmups = 2): Promise<number> {
  const config = { query: "key ~ '%'", columns: MATRIX_COLUMNS, pageSize: 100, treeView: false };
  const space = { id: fixture.spaceId, key: fixture.spaceKey, isolated: false };

  for (let run = 0; run < warmups; run += 1) {
    await runMatrixForUser({ space, userId: fixture.userId, config });
  }

  const timings: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const result = await runMatrixForUser({ space, userId: fixture.userId, config });
    timings.push(performance.now() - started);
    if (!result.ok) throw new Error('the matrix query failed');
  }

  timings.sort((a, b) => a - b);
  return timings[Math.max(Math.ceil(runs * 0.95) - 1, 0)]!;
}

describe.skipIf(process.env.SKIP_PERF === '1')('performance budget (spec 07 §5)', () => {
  it.each(budgets)('$name stays under $budgetMs ms at p95', async ({ query, budgetMs }) => {
    const measured = await p95(query);
    // Reported either way, so a CI log shows the margin rather than just pass/fail.
    console.log(`  p95 ${measured.toFixed(1)}ms of ${budgetMs}ms — ${query}`);
    expect(measured).toBeLessThan(budgetMs);
  }, 120_000);

  it('traceability matrix page, 100 rows, 8 columns stays under 600 ms at p95', async () => {
    const measured = await matrixP95();
    console.log(`  p95 ${measured.toFixed(1)}ms of 600ms — matrix, 100 rows, 8 columns`);
    expect(measured).toBeLessThan(600);
  }, 180_000);
});
