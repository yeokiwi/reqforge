import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_COMPARE, DEFAULT_IGNORE } from '@/domain/diff';
import { prisma } from '@/server/repositories/client';
import { loadComparable } from '@/server/usecases/diff';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { parseAndAnalyse } from '@/domain/ryql';
import { diffSides } from '@/domain/diff';
import { createCorpusSpace, dropCorpusSpace, keyOf, type FixtureHandles } from './fixtures/corpus-space';

/**
 * The diff against the corpus fixture: what it pairs, what it classifies, and what it
 * refuses to show a reader who may not see it.
 * spec: 05-baselines-and-diff.md §5; 07 rule X3
 */

let fixture: FixtureHandles;

const idsFor = async (query: string, userId: string) => {
  const analysed = parseAndAnalyse(query, { spaceKey: fixture.spaceKey, isolated: false });
  if (!analysed.ok) throw new Error(analysed.errors[0]?.message);
  return runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
  });
};

const diffOf = async (left: string, right: string, userId = fixture.userId, compare = DEFAULT_COMPARE) => {
  const [leftIds, rightIds] = await Promise.all([idsFor(left, userId), idsFor(right, userId)]);
  const [leftRows, rightRows] = await Promise.all([loadComparable(leftIds), loadComparable(rightIds)]);
  return diffSides(leftRows, rightRows, compare, DEFAULT_IGNORE, ['added', 'removed', 'modified', 'unchanged'], 600);
};

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
}, 180_000);

afterAll(async () => {
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('the diff over two queries (spec 05 §5.1)', () => {
  it('a query against itself is entirely unchanged', async () => {
    const outcome = await diffOf("key ~ 'FN-%'", "key ~ 'FN-%'");

    expect(outcome.summary.modified).toBe(0);
    expect(outcome.summary.added).toBe(0);
    expect(outcome.summary.removed).toBe(0);
    expect(outcome.summary.unchanged).toBeGreaterThan(100);
  });

  it('a subset on one side is added or removed, never modified', async () => {
    const outcome = await diffOf(`key = '${keyOf(0)}'`, `key ~ 'FN-00%'`);

    expect(outcome.summary.removed).toBe(0);
    expect(outcome.summary.added).toBeGreaterThan(0);
    expect(outcome.summary.modified).toBe(0);
  });

  it('diffing a subset is free, which is why the model is two queries', async () => {
    const narrow = await diffOf(`key ~ 'FN-00%'`, `key ~ 'FN-00%'`);
    const wide = await diffOf("key ~ 'FN-%'", "key ~ 'FN-%'");
    expect(narrow.summary.unchanged).toBeLessThan(wide.summary.unchanged);
  });

  it('sees a live edit as modified, and says which field moved', async () => {
    const target = await prisma.requirement.findFirstOrThrow({
      where: { spaceId: fixture.spaceId, baselineId: null, upperKey: keyOf(0) },
    });

    const before = await loadComparable([target.id]);
    await prisma.requirement.update({ where: { id: target.id }, data: { title: 'Rewritten for the diff' } });
    const after = await loadComparable([target.id]);

    const outcome = diffSides(before, after, DEFAULT_COMPARE, DEFAULT_IGNORE, ['modified'], 600);
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.changed).toEqual(['title']);

    await prisma.requirement.update({ where: { id: target.id }, data: { title: target.title } });
  });

  it('compares dependencies only when asked', async () => {
    const withEdges = { ...DEFAULT_COMPARE, dependencies: true };
    const outcome = await diffOf("key ~ 'FN-%'", "key ~ 'FN-%'", fixture.userId, withEdges);
    // Same query both sides: still unchanged, now including the edges.
    expect(outcome.summary.modified).toBe(0);
  });

  it('pairs the frozen snapshot against the live rows by key (spec 05 §5.2 step 1)', async () => {
    const outcome = await diffOf(`baseline = ${fixture.baselineNumber}`, "key ~ '%'");

    // The fixture's baseline holds a subset, so the live side adds the rest; nothing is
    // removed, because every baselined key still exists live.
    expect(outcome.summary.removed).toBe(0);
    expect(outcome.summary.added).toBeGreaterThan(0);
  });

  it('rule X3: a row the reader cannot see is on neither side', async () => {
    const mine = await diffOf("key ~ '%'", "key ~ '%'");
    const theirs = await diffOf("key ~ '%'", "key ~ '%'", fixture.strangerId);

    const total = (outcome: typeof mine) =>
      outcome.summary.added + outcome.summary.removed + outcome.summary.modified + outcome.summary.unchanged;

    expect(total(theirs)).toBeLessThan(total(mine));
    // And what they cannot see never shows up as removed, which would leak that it exists.
    expect(theirs.summary.removed).toBe(0);
    expect(theirs.summary.added).toBe(0);
  });
});
