import { describe, expect, it } from 'vitest';
import { classificationBanner, cleanLabelName, highest } from '../classification';

const official = { id: 'a', name: 'Official', rank: 10 };
const closed = { id: 'b', name: 'Official (Closed)', rank: 20 };
const secret = { id: 'c', name: 'Secret', rank: 30 };

/** spec: 07-permissions-and-limits.md §2.3; RD-060. */
describe('classification', () => {
  it('the highest label wins, whatever the order', () => {
    expect(highest([official, secret, closed])).toBe(secret);
    expect(highest([closed, null, official, undefined])).toBe(closed);
  });

  it('no label at all is null, not an empty label', () => {
    expect(highest([])).toBeNull();
    expect(highest([null, undefined])).toBeNull();
    expect(classificationBanner(null)).toBeNull();
  });

  it('prints as a banner', () => {
    expect(classificationBanner(secret)).toBe('Classification: Secret');
  });

  it('refuses a label that would not print as written in a header', () => {
    expect(cleanLabelName('  Official   (Closed) ')).toBe('Official (Closed)');
    expect(cleanLabelName('R&D only')).toBeNull();
    expect(cleanLabelName('')).toBeNull();
    expect(cleanLabelName('x'.repeat(61))).toBeNull();
    expect(cleanLabelName(42)).toBeNull();
  });
});
