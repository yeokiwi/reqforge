import { describe, expect, it } from 'vitest';
import {
  formatKey,
  highestNumber,
  matchesAnyPattern,
  numberOf,
  parsePattern,
  resetSequenceTo,
  suggestNextKey,
} from '../pattern';

const pattern = (source: string) => {
  const parsed = parsePattern(source);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.pattern;
};

describe('key patterns (spec 03 §4.2)', () => {
  it('splits a pattern into prefix, width and suffix', () => {
    expect(pattern('FN-###')).toMatchObject({ prefix: 'FN-', width: 3, suffix: '' });
    expect(pattern('REQ-##-B')).toMatchObject({ prefix: 'REQ-', width: 2, suffix: '-B' });
  });

  it('rejects patterns with no placeholder, several runs, or invalid output', () => {
    expect(parsePattern('FN-001')).toMatchObject({ ok: false, problem: 'NO_PLACEHOLDER' });
    expect(parsePattern('#-FN-#')).toMatchObject({ ok: false, problem: 'MULTIPLE_RUNS' });
    expect(parsePattern('###')).toMatchObject({ ok: false, problem: 'INVALID_EXAMPLE' });
  });

  it('formats and parses numbers, including past the padding width', () => {
    expect(formatKey(pattern('FN-###'), 7)).toBe('FN-007');
    expect(numberOf(pattern('FN-###'), 'FN-007')).toBe(7);
    expect(numberOf(pattern('FN-###'), 'fn-042')).toBe(42);
    expect(numberOf(pattern('FN-###'), 'FN-1000')).toBe(1000);
    expect(numberOf(pattern('FN-###'), 'FN-7')).toBeNull();
    expect(numberOf(pattern('FN-###'), 'BR-007')).toBeNull();
  });
});

describe('suggestion (spec 03 §4.2)', () => {
  const fn = pattern('FN-###');

  it('takes the higher of the stored sequence and the highest existing number', () => {
    expect(suggestNextKey({ pattern: fn, nextSequence: 1, existingKeys: ['FN-001', 'FN-004'] })).toEqual({
      key: 'FN-005',
      sequence: 5,
    });
    expect(suggestNextKey({ pattern: fn, nextSequence: 9, existingKeys: ['FN-001'] })).toEqual({
      key: 'FN-009',
      sequence: 9,
    });
  });

  it('never rewinds after a deletion: the sequence survives the key disappearing', () => {
    // FN-004 existed, advanced the sequence to 5, and was then deleted.
    expect(suggestNextKey({ pattern: fn, nextSequence: 5, existingKeys: ['FN-001'] }).key).toBe('FN-005');
  });

  it('reset rewinds to the highest live key plus one', () => {
    expect(resetSequenceTo(fn, ['FN-001', 'FN-002'])).toBe(3);
    expect(resetSequenceTo(fn, [])).toBe(1);
    expect(highestNumber(fn, ['FN-001', 'BR-900'])).toBe(1);
  });

  it('ignores keys belonging to another pattern', () => {
    expect(suggestNextKey({ pattern: fn, nextSequence: 1, existingKeys: ['BR-900'] }).key).toBe('FN-001');
  });
});

describe('locking (spec 03 §4.3)', () => {
  it('accepts a key matching any configured pattern and refuses the rest', () => {
    expect(matchesAnyPattern(['FN-###', 'BR-###'], 'BR-012')).toBe(true);
    expect(matchesAnyPattern(['FN-###'], 'XX-012')).toBe(false);
    expect(matchesAnyPattern([], 'FN-001')).toBe(false);
  });
});
