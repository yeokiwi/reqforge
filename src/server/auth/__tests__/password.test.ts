import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toEqual(b);
  });

  it('rejects a malformed or truncated stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$YWJj$YWJj')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
