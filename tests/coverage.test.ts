import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/domain/errors';
import { parseAndAnalyse } from '@/domain/ryql';
import { computeCoverage } from '@/domain/traceability/coverage';
import { prisma } from '@/server/repositories/client';
import { effectivePermissions } from '@/server/repositories/spaces';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { fetchCoverageCounts } from '@/server/repositories/traceability';
import {
  createCorpusSpace,
  dropCorpusSpace,
  isDeleted,
  isRestricted,
  TOTAL,
  type FixtureHandles,
} from './fixtures/corpus-space';

let fixture: FixtureHandles;
let actor: 'user' | 'stranger' = 'user';

// The gate itself is real: the mock resolves the session, then defers to the same
// permission lookup the app uses, so "EXPORT is required" is actually exercised.
vi.mock('@/server/authz', () => ({
  requireSpace: async (_spaceKey: string, permission = 'VIEW') => {
    const userId = actor === 'stranger' ? fixture.strangerId : fixture.userId;
    const permissions = await effectivePermissions(userId, fixture.spaceId);
    if (!permissions.includes(permission as 'VIEW')) {
      throw new ForbiddenError(`You need the ${permission} permission.`);
    }
    return {
      user: { id: userId },
      space: { id: fixture.spaceId, key: fixture.spaceKey, isolated: false, classification: null },
      permissions,
      can: (candidate: string) => permissions.includes(candidate as 'VIEW'),
    };
  },
}));

const { runCoverageUseCase, setCoverageTargetUseCase } = await import('@/server/usecases/coverage');
const { runDependencyMatrixUseCase } = await import('@/server/usecases/dependency-matrix');

/** Counts straight from the database, with no use case in the way. */
async function countsFor(query: string, userId: string) {
  const analysed = parseAndAnalyse(query, { spaceKey: fixture.spaceKey, isolated: false });
  if (!analysed.ok) throw new Error(analysed.errors.map((error) => error.message).join('; '));

  const visibility = visibilityPredicate(userId, await groupIdsOf(userId));
  const ids = await runSearchIds(analysed.query.expr, { visibility });
  return { ids, counts: await fetchCoverageCounts(ids) };
}

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.coverageTarget.deleteMany({ where: { spaceId: fixture.spaceId } });
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('coverage over a population (spec 04 §4.1)', () => {
  it('counts a requirement as covered when it has at least one dependency of that kind', async () => {
    actor = 'user';
    const result = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key ~ 'FN-%'" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every FN requirement refines a BR one, so "depends on — refines" is total coverage.
    const refines = result.rows.find((row) => row.relationship === 'refines' && row.direction === 'to')!;
    expect(refines.covered).toBe(refines.population);
    expect(refines.percent).toBe(100);

    // Nothing depends *on* an FN requirement, so the other direction is empty.
    const inbound = result.rows.find((row) => row.relationship === null && row.direction === 'from')!;
    expect(inbound.covered).toBe(0);
    expect(inbound.uncovered).toBe(inbound.population);
  });

  it('every figure is a query that returns exactly that set', async () => {
    actor = 'user';
    const result = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key ~ 'BR-%'" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inbound = result.rows.find((row) => row.relationship === 'refines' && row.direction === 'from')!;
    const covered = await countsFor(inbound.coveredQuery, fixture.userId);
    const uncovered = await countsFor(inbound.uncoveredQuery, fixture.userId);

    expect(covered.ids.length).toBe(inbound.covered);
    expect(uncovered.ids.length).toBe(inbound.uncovered);
    expect(covered.ids.length + uncovered.ids.length).toBe(inbound.population);
  });

  it('refuses an empty query, and needs EXPORT', async () => {
    actor = 'user';
    const empty = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok && 'refusal' in empty) expect(empty.refusal.reason).toBe('empty-query');

    // A member with neither EXPORT nor ADMIN cannot run coverage at all (spec 04 §4.3).
    const outsider = await prisma.user.create({
      data: { email: `outsider-${Date.now()}@test`, name: 'Outsider', passwordHash: 'scrypt$x$y' },
    });
    await prisma.membership.create({
      data: { spaceId: fixture.spaceId, userId: outsider.id, permissions: ['VIEW'] },
    });
    const previous = fixture.strangerId;
    fixture.strangerId = outsider.id;
    actor = 'stranger';
    await expect(runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key ~ '%'" })).rejects.toThrow(/EXPORT/);

    actor = 'user';
    fixture.strangerId = previous;
    await prisma.membership.deleteMany({ where: { spaceId: fixture.spaceId, userId: outsider.id } });
    await prisma.user.delete({ where: { id: outsider.id } });
  });
});

/**
 * The slice 9 acceptance check: two readers with different access see different numbers,
 * and each reader's numbers add up (rule X2, RD-033).
 */
describe('coverage respects visibility and stays internally consistent', () => {
  it('gives two readers different, self-consistent numbers', async () => {
    actor = 'user';
    const owner = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key ~ '%'" });
    actor = 'stranger';
    const stranger = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key ~ '%'" });
    actor = 'user';

    expect(owner.ok && stranger.ok).toBe(true);
    if (!owner.ok || !stranger.ok) return;

    // The annex is invisible to the stranger, so the denominator differs.
    const restrictedActive = Array.from({ length: TOTAL }, (_, index) => index).filter(
      (index) => isRestricted(index) && !isDeleted(index),
    ).length;
    expect(owner.population - stranger.population).toBe(restrictedActive);

    for (const result of [owner, stranger]) {
      for (const row of result.rows) {
        expect(row.covered + row.uncovered).toBe(row.population);
        expect(row.population).toBe(result.population);
        expect(row.covered).toBeLessThanOrEqual(row.population);
        expect(row.percent).toBeCloseTo(Math.round((row.covered / row.population) * 1000) / 10, 1);
      }
    }
  });

  it('RD-033: an edge into a requirement the reader cannot see still counts as covered', async () => {
    // FN-101 refines BR-101, which lives in the restricted annex.
    actor = 'stranger';
    const result = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key = 'FN-101'" });
    actor = 'user';

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refines = result.rows.find((row) => row.relationship === 'refines' && row.direction === 'to')!;
    expect(refines.population).toBe(1);
    expect(refines.covered).toBe(1);
  });
});

describe('targets (spec 04 §4.2)', () => {
  it('flags a row below target, and needs ADMIN to set one', async () => {
    actor = 'stranger';
    await expect(
      setCoverageTargetUseCase({
        spaceKey: fixture.spaceKey,
        relationship: 'refines',
        direction: 'from',
        targetPercent: 90,
      }),
    ).rejects.toThrow(/ADMIN/);

    actor = 'user';
    await prisma.membership.updateMany({
      where: { spaceId: fixture.spaceId, userId: fixture.userId },
      data: { permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
    });

    await setCoverageTargetUseCase({
      spaceKey: fixture.spaceKey,
      relationship: 'refines',
      direction: 'to',
      targetPercent: 90,
    });

    // Across the whole space only the FN requirements refine anything, so outbound
    // coverage sits well under the 90% target.
    const result = await runCoverageUseCase({ spaceKey: fixture.spaceKey, query: "key ~ '%'" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = result.rows.find((entry) => entry.relationship === 'refines' && entry.direction === 'to')!;
    expect(row.targetPercent).toBe(90);
    expect(row.percent).toBeLessThan(90);
    expect(row.belowTarget).toBe(true);

    // And a row without a target is never flagged.
    const untargeted = result.rows.find((entry) => entry.relationship === 'refines' && entry.direction === 'from')!;
    expect(untargeted.targetPercent).toBeNull();
    expect(untargeted.belowTarget).toBe(false);
  });
});

/** The other slice 9 acceptance check: over the cap, the grid offers the export. */
describe('the dependency grid cap (spec 04 §3)', () => {
  it('refuses a population over 200 and offers the export rather than erroring', async () => {
    actor = 'user';
    const result = await runDependencyMatrixUseCase({ spaceKey: fixture.spaceKey, query: "key ~ '%'" });

    expect(result.ok).toBe(false);
    if (result.ok || !('refusal' in result)) throw new Error('expected a refusal');
    expect(result.refusal.reason).toBe('over-cap');
    expect(result.refusal.population).toBeGreaterThan(200);
    expect(result.refusal.message).toContain('export');
  });

  it('builds the grid under the cap, reading row-as-child → column-as-parent', async () => {
    actor = 'user';
    const result = await runDependencyMatrixUseCase({
      spaceKey: fixture.spaceKey,
      query: "key IN ('FN-001', 'BR-001')",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grid.axis.map((entry) => entry.key)).toEqual(['BR-001', 'FN-001']);
    expect(result.grid.cells.get('FN-001\u0000BR-001')).toEqual(['refines']);
    expect(result.grid.cells.get('BR-001\u0000FN-001')).toBeUndefined();
    expect(result.grid.legend).toEqual([{ initials: 'RE', relationship: 'refines' }]);
  });

  it('refuses an empty query', async () => {
    actor = 'user';
    const empty = await runDependencyMatrixUseCase({ spaceKey: fixture.spaceKey, query: '' });
    expect(empty.ok).toBe(false);
    if (!empty.ok && 'refusal' in empty) expect(empty.refusal.reason).toBe('empty-query');
  });
});

describe('the counting query itself', () => {
  it('agrees with computeCoverage on the same ids', async () => {
    const { ids, counts } = await countsFor("key ~ 'FN-00%'", fixture.userId);
    const rows = computeCoverage(ids.length, [
      { relationship: null, direction: 'to', covered: counts.anyTo },
      ...counts.perRelationship.map((row) => ({
        relationship: row.relationship,
        direction: row.direction,
        covered: Number(row.covered),
      })),
    ]);

    expect(rows[0]!.covered).toBe(counts.anyTo);
    expect(rows.every((row) => row.covered <= ids.length)).toBe(true);
  });
});
