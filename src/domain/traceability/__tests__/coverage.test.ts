import { describe, expect, it } from 'vitest';
import {
  computeCoverage,
  findRelationshipCollisions,
  queriesForRow,
  type CoverageCount,
} from '../coverage';

const counts: CoverageCount[] = [
  { relationship: null, direction: 'to', covered: 18 },
  { relationship: 'Refines', direction: 'to', covered: 12 },
  { relationship: 'Verifies', direction: 'to', covered: 6 },
  { relationship: 'Refines', direction: 'from', covered: 4 },
];

describe('coverage maths (spec 04 §4.1)', () => {
  it('reports count and percentage, with uncovered as the complement', () => {
    const rows = computeCoverage(23, counts);
    const refines = rows.find((row) => row.relationship === 'Refines' && row.direction === 'to')!;

    expect(refines).toMatchObject({ population: 23, covered: 12, uncovered: 11 });
    expect(refines.percent).toBeCloseTo(52.2, 1);
    // RY's example number, from research §4.4: "6 of your 23".
    const verifies = rows.find((row) => row.relationship === 'Verifies')!;
    expect(`${verifies.covered} of your ${verifies.population}`).toBe('6 of your 23');
  });

  it('covered + uncovered always equals the population', () => {
    for (const row of computeCoverage(23, counts)) {
      expect(row.covered + row.uncovered).toBe(row.population);
    }
  });

  it('puts the synthetic any-dependency row first', () => {
    const rows = computeCoverage(23, counts);
    expect(rows[0]!.relationship).toBeNull();
    expect(rows[0]!.label).toBe('Depends on — any dependency');
  });

  it('reports 0% rather than NaN for an empty population', () => {
    const rows = computeCoverage(0, [{ relationship: 'Refines', direction: 'to', covered: 0 }]);
    expect(rows[0]!.percent).toBe(0);
    expect(rows[0]!.uncovered).toBe(0);
  });

  it('never reports more covered than the population', () => {
    const rows = computeCoverage(5, [{ relationship: 'Refines', direction: 'to', covered: 9 }]);
    expect(rows[0]!.covered).toBe(5);
    expect(rows[0]!.percent).toBe(100);
  });

  it('flags a row below its target (spec 04 §4.2)', () => {
    const rows = computeCoverage(23, counts, [
      { relationship: 'Refines', direction: 'to', targetPercent: 80 },
      { relationship: 'Verifies', direction: 'to', targetPercent: 20 },
    ]);

    expect(rows.find((row) => row.relationship === 'Refines' && row.direction === 'to')).toMatchObject({
      targetPercent: 80,
      belowTarget: true,
    });
    expect(rows.find((row) => row.relationship === 'Verifies')).toMatchObject({ belowTarget: false });
    // The synthetic row has no target of its own.
    expect(rows[0]!.targetPercent).toBeNull();
  });
});

describe('every figure is a query (spec 04 §4.1)', () => {
  it('composes with the population query in both directions', () => {
    const [any, refines] = computeCoverage(23, [
      { relationship: null, direction: 'to', covered: 18 },
      { relationship: 'Refines', direction: 'to', covered: 12 },
    ]);

    expect(queriesForRow(refines!, "key ~ 'FN-%'")).toEqual({
      covered: "(key ~ 'FN-%') AND to@Refines IS NOT NULL",
      uncovered: "(key ~ 'FN-%') AND to@Refines IS NULL",
    });
    expect(queriesForRow(any!, "key ~ 'FN-%'").uncovered).toBe("(key ~ 'FN-%') AND to IS NULL");
  });

  it('quotes a relationship containing whitespace, and copes with no population query', () => {
    const [row] = computeCoverage(1, [{ relationship: 'Is verified by', direction: 'from', covered: 1 }]);
    expect(queriesForRow(row!, '  ')).toEqual({
      covered: "from@'Is verified by' IS NOT NULL",
      uncovered: "from@'Is verified by' IS NULL",
    });
  });
});

describe('RD-032 — near-duplicate relationship names are surfaced, not merged', () => {
  it('reports names differing only by case', () => {
    expect(findRelationshipCollisions(['Refines', 'refines', 'Verifies'])).toEqual([
      { names: ['Refines', 'refines'], reason: 'case' },
    ]);
  });

  it('reports names differing only by whitespace', () => {
    expect(findRelationshipCollisions(['Is verified by', 'Is  verified  by'])).toEqual([
      { names: ['Is  verified  by', 'Is verified by'], reason: 'whitespace' },
    ]);
  });

  it('says nothing when the names are genuinely distinct', () => {
    expect(findRelationshipCollisions(['Refines', 'Verifies'])).toEqual([]);
  });
});
