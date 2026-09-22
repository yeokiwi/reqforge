import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  buildMapping,
  decompose,
  planRename,
  previewRows,
} from '../rename';

/** spec: 03-authoring-and-indexing.md §5 — batch rename. */
describe('decompose', () => {
  it('splits a selection into the prefix, the variable middle and the suffix', () => {
    // `FN-017` stops the common prefix at `FN-0`, so the middles carry the leading zero.
    expect(decompose(['FN-001', 'FN-002', 'FN-017'])).toEqual({
      prefix: 'FN-0',
      middles: ['01', '02', '17'],
      suffix: '',
    });
  });

  it('finds a common suffix as well as a common prefix', () => {
    expect(decompose(['REQ-1-A', 'REQ-2-A', 'REQ-3-A'])).toEqual({
      prefix: 'REQ-',
      middles: ['1', '2', '3'],
      suffix: '-A',
    });
  });

  it('never leaves a middle empty, because the transform has to anchor on one', () => {
    // The naive longest common prefix is `FN-1`, which would leave the first middle empty.
    expect(decompose(['FN-1', 'FN-12'])).toEqual({ prefix: 'FN-', middles: ['1', '12'], suffix: '' });
  });

  it('treats a single key as all middle', () => {
    expect(decompose(['FN-001'])).toEqual({ prefix: '', middles: ['FN-001'], suffix: '' });
  });

  it('handles a selection with nothing in common', () => {
    expect(decompose(['ALPHA', 'BETAS'])).toEqual({ prefix: '', middles: ['ALPHA', 'BETAS'], suffix: '' });
  });

  it('still finds a suffix the reader did not plan on', () => {
    // Both end in `A`, so the decomposition says so rather than pretending otherwise.
    expect(decompose(['ALPHA', 'BETA'])).toEqual({ prefix: '', middles: ['ALPH', 'BET'], suffix: 'A' });
  });
});

describe('applyTransform', () => {
  const selection = decompose(['FN-001', 'FN-002', 'FN-017']);

  it('applies the first line`s edit to every other line', () => {
    const transformed = applyTransform('SYS-001', selection);
    expect(transformed).toMatchObject({ anchored: true, prefix: 'SYS-0', suffix: '' });
    expect(transformed.anchored && transformed.keys).toEqual(['SYS-001', 'SYS-002', 'SYS-017']);
  });

  it('picks up a new suffix too', () => {
    const transformed = applyTransform('SYS-001-v2', selection);
    expect(transformed.anchored && transformed.keys).toEqual(['SYS-001-v2', 'SYS-002-v2', 'SYS-017-v2']);
  });

  it('chooses the occurrence nearest the middle`s original position when it repeats', () => {
    const repeated = decompose(['A-1-X', 'A-2-X']);
    expect(repeated).toEqual({ prefix: 'A-', middles: ['1', '2'], suffix: '-X' });
    // `1` appears at index 2 and index 5 of `ZZ1ZZ1`; the middle sat at index 2 in the
    // original key, so that is the one the transformation anchors on. Reading it the
    // other way would rename `A-2-X` to `ZZ1ZZ2` — the digit the reader edited would stay
    // put and the one they did not touch would move.
    const transformed = applyTransform('ZZ1ZZ1', repeated);
    expect(transformed.anchored && transformed.keys).toEqual(['ZZ1ZZ1', 'ZZ2ZZ1']);
  });

  it('refuses when the edit removes the variable part, rather than guessing', () => {
    const transformed = applyTransform('SYS-TOTALLY-NEW', decompose(['FN-001', 'FN-002']));
    expect(transformed.anchored).toBe(false);
    expect(transformed.anchored === false && transformed.middle).toBe('1');
  });
});

describe('planRename', () => {
  it('accepts a clean batch', () => {
    const plan = planRename({ pairs: [{ from: 'FN-1', to: 'SYS-1' }, { from: 'FN-2', to: 'SYS-2' }] });
    expect(plan.problems).toBe(0);
    expect(plan.pairs).toEqual([{ from: 'FN-1', to: 'SYS-1' }, { from: 'FN-2', to: 'SYS-2' }]);
  });

  it('rejects an invalid target key with the validator`s own message', () => {
    const plan = planRename({ pairs: [{ from: 'FN-1', to: 'has space' }] });
    expect(plan.rows[0]?.problem).toBe('INVALID_KEY');
    expect(plan.pairs).toEqual([]);
  });

  it('rejects a target a locked space would not accept (spec 03 §4.3)', () => {
    const plan = planRename({ pairs: [{ from: 'FN-1', to: 'XX-1' }], lockedPatterns: ['FN-###'] });
    expect(plan.rows[0]?.problem).toBe('PATTERN_MISMATCH');
  });

  it('catches two rows racing for one key before anything is written', () => {
    const plan = planRename({ pairs: [{ from: 'FN-1', to: 'SYS-1' }, { from: 'FN-2', to: 'sys-1' }] });
    expect(plan.rows.map((row) => row.problem)).toEqual(['DUPLICATE_TARGET', 'DUPLICATE_TARGET']);
    expect(plan.pairs).toEqual([]);
  });

  it('marks a row that would not change anything', () => {
    expect(planRename({ pairs: [{ from: 'FN-1', to: 'FN-1' }] }).rows[0]?.problem).toBe('UNCHANGED');
  });

  it('treats a case-only change as a real rename', () => {
    expect(planRename({ pairs: [{ from: 'fn-1', to: 'FN-1' }] }).problems).toBe(0);
  });
});

describe('previewRows', () => {
  it('lists at most 50 and counts the remainder', () => {
    const pairs = Array.from({ length: 63 }, (_, index) => ({ from: `FN-${index}`, to: `SYS-${index}` }));
    const preview = previewRows(planRename({ pairs }));
    expect(preview.rows).toHaveLength(50);
    expect(preview.remainder).toBe(13);
  });
});

describe('buildMapping', () => {
  it('offers both the case-insensitive and the exact lookup', () => {
    const mapping = buildMapping([{ from: 'fn-1', to: 'SYS-1' }]);
    expect(mapping.byUpper.get('FN-1')).toBe('SYS-1');
    expect(mapping.exact.get('fn-1')).toBe('SYS-1');
    expect(mapping.exact.get('FN-1')).toBeUndefined();
  });
});
