import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, isInitialized } from '../../src/main/auth.js';

describe('auth', () => {
  it('hashes and verifies password', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword(hash, 'secret')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('isInitialized false when no hash', () => {
    expect(isInitialized('')).toBe(false);
    expect(isInitialized('$2a$10$xxx')).toBe(true);
  });
});
