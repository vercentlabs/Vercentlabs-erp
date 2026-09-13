import { describe, expect, it } from 'vitest';
import { constantTimeEqual, generateOpaqueToken, hashToken } from '../src/crypto/token-hash.js';

describe('token-hash', () => {
  it('generateOpaqueToken produces at least 256 bits of randomness (32 bytes) by default', () => {
    const token = generateOpaqueToken();
    // base64url of 32 bytes is 43 chars (no padding).
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('generateOpaqueToken never repeats across many calls', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(1000);
  });

  it('hashToken is deterministic for the same input', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('hashToken produces different digests for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('hashToken never returns the raw input (not a no-op)', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).not.toBe(token);
  });

  it('constantTimeEqual matches identical strings and rejects different ones', () => {
    expect(constantTimeEqual('secret-value', 'secret-value')).toBe(true);
    expect(constantTimeEqual('secret-value', 'different-value')).toBe(false);
    expect(constantTimeEqual('short', 'a-much-longer-string')).toBe(false);
  });
});
