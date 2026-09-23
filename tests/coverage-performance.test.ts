import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAndAnalyse } from '@/domain/ryql';
import { computeCoverage } from '@/domain/traceability/coverage';
import { prisma } from '@/server/repositories/client';
import { runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { fetchCoverageCounts } from '@/server/repositories/traceability';
import {
  COVERAGE_TOTAL,
  REFINES_COVERED,
  VERIFIES_COVERED,
  createCoverageSpace,
  dropCoverageSpace,
  type CoverageFixture,
} from './fixtures/coverage-space';

let fixture: CoverageFixture;

/**
 * Coverage end to end over 5,000 requirements, with no session in the way: population,
 * counts, arithmetic. Its timing moved to the perf suite (`pnpm perf`, RD-073), which
 * measures it through the use case on the scale fixture.
 */
async function coverage() {
  const analysed = parseAndAnalyse("key ~ '%'", { spaceKey: fixture.spaceKey, isolated: false });
  if (!analysed.ok) throw new Error('the fixture query does not parse');

  const visibility = visibilityPredicate(fixture.userId, []);
  const ids = await runSearchIds(analysed.query.expr, { visibility });
  const counts = await fetchCoverageCounts(ids);

  return {
    population: ids.length,
    rows: computeCoverage(ids.length, [
      { relationship: null, direction: 'to', covered: counts.anyTo },
      ...counts.perRelationship.map((row) => ({
        relationship: row.relationship,
        direction: row.direction,
        covered: Number(row.covered),
      })),
    ]),
  };
}

beforeAll(async () => {
  fixture = await createCoverageSpace(prisma);
  await prisma.$executeRawUnsafe('ANALYZE "Requirement"');
  await prisma.$executeRawUnsafe('ANALYZE "Dependency"');
}, 300_000);

afterAll(async () => {
  await dropCoverageSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('coverage at the size spec 07 §5 names', () => {
  it('counts 5,000 requirements correctly', async () => {
    const result = await coverage();

    expect(result.population).toBe(COVERAGE_TOTAL);
    expect(result.rows.find((row) => row.relationship === 'Refines' && row.direction === 'to')?.covered).toBe(
      REFINES_COVERED,
    );
    expect(result.rows.find((row) => row.relationship === 'Verifies' && row.direction === 'to')?.covered).toBe(
      VERIFIES_COVERED,
    );
    // The synthetic row counts a requirement once however many relationships it has.
    expect(result.rows[0]).toMatchObject({ relationship: null, direction: 'to', covered: REFINES_COVERED });
  }, 120_000);
});
