import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The client must be constructed with query events on, so the env is set before it loads.
process.env.PRISMA_QUERY_EVENTS = '1';

const { prisma } = await import('@/server/repositories/client');
const { runMatrixForUser } = await import('@/server/usecases/matrix');
const { createCorpusSpace, dropCorpusSpace } = await import('./fixtures/corpus-space');

type Fixture = Awaited<ReturnType<typeof createCorpusSpace>>;
let fixture: Fixture;

let counting = false;
let queries = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on('query', () => {
  if (counting) queries += 1;
});

/** Runs the matrix and reports how many SQL statements it took. */
async function statementsFor(options: { columns: unknown[]; pageSize: number }): Promise<number> {
  const config = { query: "key ~ '%'", columns: options.columns, pageSize: options.pageSize, treeView: false };

  // Warm up outside the count: the first call pays for connection setup.
  await runMatrixForUser({
    space: { id: fixture.spaceId, key: fixture.spaceKey, isolated: false },
    userId: fixture.userId,
    config,
  });

  queries = 0;
  counting = true;
  const result = await runMatrixForUser({
    space: { id: fixture.spaceId, key: fixture.spaceKey, isolated: false },
    userId: fixture.userId,
    config,
  });
  counting = false;

  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  expect(result.page.rows.length).toBe(options.pageSize);
  return queries;
}

const EIGHT_COLUMNS = [
  { kind: 'key' },
  { kind: 'title' },
  { kind: 'status' },
  { kind: 'document' },
  { kind: 'property', name: 'Category' },
  { kind: 'property', name: 'Priority' },
  { kind: 'external', name: 'Approval' },
  { kind: 'dependency', direction: 'to', relationship: 'refines', depth: 1, render: 'key' },
];

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
  await prisma.$executeRawUnsafe('ANALYZE');
}, 120_000);

afterAll(async () => {
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

/**
 * The slice 8 acceptance check.
 * spec: 04-traceability-and-coverage.md §2.5 — "Row query and column data are fetched in
 * two phases … Never N+1."
 */
describe('the matrix never issues a query per row', () => {
  it('takes the same number of statements for 10 rows and for 100', async () => {
    const small = await statementsFor({ columns: EIGHT_COLUMNS, pageSize: 10 });
    const large = await statementsFor({ columns: EIGHT_COLUMNS, pageSize: 100 });

    expect(large).toBe(small);
    // Two phases: the row query, its count, the defining documents, and one per column
    // kind. Nowhere near the 100 a per-row fetch would take.
    expect(large).toBeLessThanOrEqual(12);
  }, 120_000);

  it('grows with the column set, not with the row set', async () => {
    const three = await statementsFor({ columns: EIGHT_COLUMNS.slice(0, 3), pageSize: 100 });
    const eight = await statementsFor({ columns: EIGHT_COLUMNS, pageSize: 100 });

    // key, title and status come off the row itself, so they cost nothing extra.
    expect(eight).toBeGreaterThan(three);
    expect(eight - three).toBeLessThanOrEqual(5);
  }, 120_000);

  it('a transitive dependency column is one recursive query, not one per hop per row', async () => {
    const depthOne = await statementsFor({
      columns: [...EIGHT_COLUMNS.slice(0, 3), { kind: 'dependency', direction: 'to', depth: 1, render: 'key' }],
      pageSize: 100,
    });
    const depthFour = await statementsFor({
      columns: [...EIGHT_COLUMNS.slice(0, 3), { kind: 'dependency', direction: 'to', depth: 4, render: 'key' }],
      pageSize: 100,
    });

    expect(depthFour).toBe(depthOne);
  }, 120_000);
});
