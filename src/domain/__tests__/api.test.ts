import { describe, expect, it } from 'vitest';
import { intersectPermissions, normaliseScopes, parseTokenString } from '../api-scopes';
import { formatRecordId, parseRecordId } from '../record-id';
import { signPayload, verifySignature } from '../webhook-signature';
import { MAX_ATTEMPTS, nextAttemptAfter } from '../webhooks';

describe('API token scopes (RD-065)', () => {
  it('adds read to any grant, drops unknown names and keeps a stable order', () => {
    expect(normaliseScopes(['export', 'bogus', 'export'])).toEqual(['read', 'export']);
    expect(normaliseScopes([])).toEqual([]);
    expect(normaliseScopes(['admin', 'edit'])).toEqual(['read', 'edit', 'admin']);
  });

  it('never grants more than the owner holds', () => {
    expect(intersectPermissions(['VIEW', 'EDIT'], ['read', 'edit', 'admin'])).toEqual(['VIEW', 'EDIT']);
    expect(intersectPermissions(['VIEW', 'EDIT', 'ADMIN'], ['read'])).toEqual(['VIEW']);
    expect(intersectPermissions(['VIEW'], [])).toEqual([]);
  });

  it('parses only the rf_<id>_<secret> shape', () => {
    const id = 'c'.repeat(25);
    const secret = 'A'.repeat(43);
    expect(parseTokenString(`rf_${id}_${secret}`)).toEqual({ id, secret });
    expect(parseTokenString(`rf_${id}_short`)).toBeNull();
    expect(parseTokenString(`xx_${id}_${secret}`)).toBeNull();
    expect(parseTokenString('')).toBeNull();
  });
});

describe('record ids (spec 05 §4)', () => {
  it('round-trips live and frozen addresses', () => {
    expect(formatRecordId('SJ', 'J-026', null)).toBe('SJ/J-026/current');
    expect(formatRecordId('SJ', 'J-026', 3)).toBe('SJ/J-026/3');
    expect(parseRecordId('SJ/J-026/current')).toEqual({ spaceKey: 'SJ', key: 'J-026', baseline: 'current' });
    expect(parseRecordId('SJ/J-026/3')).toEqual({ spaceKey: 'SJ', key: 'J-026', baseline: 3 });
    expect(parseRecordId('SJ/J-026')).toBeNull();
    expect(parseRecordId('sj/J-026/current')).toBeNull();
  });
});

describe('webhook signing and retry schedule (RD-067)', () => {
  it('verifies its own signature and nothing else', () => {
    const header = signPayload('whsec_x', '1700000000', '{"a":1}');
    expect(header).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifySignature('whsec_x', '1700000000', '{"a":1}', header)).toBe(true);
    expect(verifySignature('whsec_x', '1700000001', '{"a":1}', header)).toBe(false);
    expect(verifySignature('whsec_y', '1700000000', '{"a":1}', header)).toBe(false);
    expect(verifySignature('whsec_x', '1700000000', '{"a":2}', header)).toBe(false);
    expect(verifySignature('whsec_x', '1700000000', '{"a":1}', 'v1=00')).toBe(false);
  });

  it('retries at +1m, 5m, 30m, 2h, 12h and then stops', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const offsets = [1, 2, 3, 4, 5].map((attempt) => (nextAttemptAfter(attempt, now)!.getTime() - now.getTime()) / 60_000);
    expect(offsets).toEqual([1, 5, 30, 120, 720]);
    expect(nextAttemptAfter(MAX_ATTEMPTS, now)).toBeNull();
    expect(MAX_ATTEMPTS).toBe(6);
  });
});
