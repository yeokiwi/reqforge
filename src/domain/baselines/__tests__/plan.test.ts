import { describe, expect, it } from 'vitest';
import {
  checkFreezeable,
  closeOverParents,
  MAX_CLOSURE_DEPTH,
  MAX_MEMBERS,
  partitionDependencies,
  type Edge,
} from '../plan';

/** spec: 05-baselines-and-diff.md §3.2 steps 1, 2 and 5 */

const edge = (childKey: string, parentKey: string, relationship = 'satisfies'): Edge => ({
  childKey,
  parentKey,
  relationship,
});

describe('closeOverParents (spec 05 §3.2 step 2)', () => {
  it('adds nothing when the seeds have no parents', () => {
    expect(closeOverParents(['FN-1', 'FN-2'], [])).toEqual({
      keys: ['FN-1', 'FN-2'],
      added: 0,
      truncated: false,
    });
  });

  it('adds a parent, and the parent of that parent, to a fixed point', () => {
    const edges = [edge('FN-1', 'BR-1'), edge('BR-1', 'ST-1')];
    const closure = closeOverParents(['FN-1'], edges);

    expect(closure.keys).toEqual(['FN-1', 'BR-1', 'ST-1']);
    expect(closure.added).toBe(2);
    expect(closure.truncated).toBe(false);
  });

  it('follows every branch, not just the first', () => {
    const edges = [edge('FN-1', 'BR-1'), edge('FN-1', 'BR-2'), edge('BR-2', 'ST-1')];
    expect(closeOverParents(['FN-1'], edges).keys).toEqual(['FN-1', 'BR-1', 'BR-2', 'ST-1']);
  });

  it('counts a key once however many members point at it', () => {
    const edges = [edge('FN-1', 'BR-1'), edge('FN-2', 'BR-1')];
    const closure = closeOverParents(['FN-1', 'FN-2'], edges);
    expect(closure.keys).toEqual(['FN-1', 'FN-2', 'BR-1']);
    expect(closure.added).toBe(1);
  });

  it('does not count a seed twice when the seeds repeat', () => {
    const closure = closeOverParents(['FN-1', 'FN-1'], []);
    expect(closure.keys).toEqual(['FN-1']);
    expect(closure.added).toBe(0);
  });

  it('terminates on a cycle rather than spinning', () => {
    const edges = [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')];
    const closure = closeOverParents(['A'], edges);

    expect(closure.keys.sort()).toEqual(['A', 'B', 'C']);
    // The cycle closes before the cap, so nothing was left unreachable.
    expect(closure.truncated).toBe(false);
  });

  it('stops at the depth cap and says the closure is partial', () => {
    // A chain longer than the cap: K0 → K1 → … → K20.
    const edges = Array.from({ length: 20 }, (_, index) => edge(`K${index}`, `K${index + 1}`));
    const closure = closeOverParents(['K0'], edges);

    expect(closure.keys).toHaveLength(MAX_CLOSURE_DEPTH + 1);
    expect(closure.truncated).toBe(true);
  });

  it('honours a smaller cap from the caller', () => {
    const edges = [edge('A', 'B'), edge('B', 'C'), edge('C', 'D')];
    const closure = closeOverParents(['A'], edges, { maxDepth: 1 });
    expect(closure.keys).toEqual(['A', 'B']);
    expect(closure.truncated).toBe(true);
  });
});

describe('partitionDependencies (spec 05 §3.2 step 5)', () => {
  const edges = [edge('FN-1', 'BR-1'), edge('FN-1', 'OUTSIDE-1'), edge('FN-2', 'FN-1')];

  it('copies an edge whose child and parent are both members', () => {
    const { internal, dangling } = partitionDependencies(edges, ['FN-1', 'FN-2', 'BR-1']);
    // BR-1 is a member now, so that edge is internal; OUTSIDE-1 still is not.
    expect(internal).toEqual([edge('FN-1', 'BR-1'), edge('FN-2', 'FN-1')]);
    expect(dangling).toEqual([edge('FN-1', 'OUTSIDE-1')]);
  });

  it('records an edge pointing outside rather than dropping it', () => {
    const { internal, dangling } = partitionDependencies(edges, ['FN-1', 'FN-2']);
    expect(internal).toEqual([edge('FN-2', 'FN-1')]);
    expect(dangling).toEqual([edge('FN-1', 'BR-1'), edge('FN-1', 'OUTSIDE-1')]);
  });

  it('ignores an edge from a non-member: it belongs to whatever contains that child', () => {
    const { internal, dangling } = partitionDependencies([edge('OTHER-1', 'FN-1')], ['FN-1']);
    expect(internal).toEqual([]);
    expect(dangling).toEqual([]);
  });

  it('keeps the relationship on a dangling edge, so the diff can name it', () => {
    const { dangling } = partitionDependencies([edge('FN-1', 'BR-9', 'verifies')], ['FN-1']);
    expect(dangling[0]?.relationship).toBe('verifies');
  });
});

describe('checkFreezeable (spec 05 §3.2 step 1)', () => {
  it('accepts a non-empty set and reports its size', () => {
    expect(checkFreezeable(['FN-1', 'FN-2'])).toEqual({ ok: true, count: 2 });
  });

  it('refuses an empty set', () => {
    const outcome = checkFreezeable([]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('selects no requirements');
  });

  it('refuses above the limit and names it (spec 07 §4)', () => {
    const outcome = checkFreezeable(Array.from({ length: 11 }, (_, index) => `K${index}`), 10);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('at most 10');
      expect(outcome.message).toContain('11 requirements');
    }
  });

  it('defaults to the per-baseline limit of spec 07 §4', () => {
    expect(MAX_MEMBERS).toBe(12_000);
  });
});
