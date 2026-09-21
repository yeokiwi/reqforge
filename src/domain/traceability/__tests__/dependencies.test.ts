import { describe, expect, it } from 'vitest';
import {
  countsByRelationship,
  groupDependencies,
  queryForGroup,
  type DependencyEdge,
} from '../dependencies';

const edge = (partial: Partial<DependencyEdge> & Pick<DependencyEdge, 'direction' | 'relationship' | 'otherKey'>): DependencyEdge => ({
  otherTitle: `Title of ${partial.otherKey}`,
  otherSpaceKey: null,
  otherStatus: 'ACTIVE',
  baselineNumber: null,
  unresolved: false,
  ...partial,
});

describe('grouping dependency edges', () => {
  it('puts outbound before inbound, then relationships alphabetically, then keys', () => {
    const groups = groupDependencies([
      edge({ direction: 'from', relationship: 'Refines', otherKey: 'FN-02' }),
      edge({ direction: 'to', relationship: 'Verifies', otherKey: 'TC-01' }),
      edge({ direction: 'to', relationship: 'Refines', otherKey: 'BR-02' }),
      edge({ direction: 'to', relationship: 'Refines', otherKey: 'BR-01' }),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      'Depends on — Refines',
      'Depends on — Verifies',
      'Depended on by — Refines',
    ]);
    expect(groups[0]!.edges.map((entry) => entry.otherKey)).toEqual(['BR-01', 'BR-02']);
  });

  it('keeps unresolved edges in their group so broken links stay visible (P2)', () => {
    const groups = groupDependencies([
      edge({ direction: 'to', relationship: 'Refines', otherKey: 'BR-99', unresolved: true }),
    ]);
    expect(groups[0]!.edges[0]!.unresolved).toBe(true);
  });

  it('reproduces a group as an RQL query, quoting a relationship with a space', () => {
    const [refines] = groupDependencies([edge({ direction: 'to', relationship: 'Refines', otherKey: 'BR-01' })]);
    expect(queryForGroup(refines!, 'BR-01')).toBe("to@Refines = 'BR-01'");

    const [spaced] = groupDependencies([
      edge({ direction: 'from', relationship: 'Is verified by', otherKey: 'TC-01' }),
    ]);
    expect(queryForGroup(spaced!, 'TC-01')).toBe("from@'Is verified by' = 'TC-01'");
  });

  it('counts by relationship, which coverage builds on in slice 9', () => {
    const counts = countsByRelationship([
      edge({ direction: 'to', relationship: 'Refines', otherKey: 'BR-01' }),
      edge({ direction: 'to', relationship: 'Refines', otherKey: 'BR-02' }),
      edge({ direction: 'from', relationship: 'Verifies', otherKey: 'TC-01' }),
    ]);
    expect([...counts.entries()].sort()).toEqual([
      ['Refines', 2],
      ['Verifies', 1],
    ]);
  });
});
