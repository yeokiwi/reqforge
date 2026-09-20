import { describe, expect, it } from 'vitest';
import { checkKey, isValidKey, upperKey } from '../validate';

describe('key validation (spec 03 §4.1)', () => {
  it.each(['FN-001', 'BR.2', 'a1', 'SYS_REQ-0004', 'X9'])('accepts %s', (key) => {
    expect(isValidKey(key)).toBe(true);
  });

  it.each([
    ['', 'EMPTY'],
    ['A', 'TOO_SHORT'],
    ['FN 001', 'ILLEGAL_CHARACTER'],
    ['FN/001', 'ILLEGAL_CHARACTER'],
    ['-FN1', 'EDGE_SEPARATOR'],
    ['FN1-', 'EDGE_SEPARATOR'],
    ['123', 'ALL_DIGITS'],
    ['A'.repeat(65), 'TOO_LONG'],
  ])('rejects %s', (key, problem) => {
    const result = checkKey(key);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe(problem);
  });

  it('uppercases for case-insensitive identity', () => {
    expect(upperKey(' fn-001 ')).toBe('FN-001');
    const checked = checkKey('fn-001');
    expect(checked.ok && checked.upperKey).toBe('FN-001');
  });
});
