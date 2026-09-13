import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  verifyPassword,
  ARGON2ID_PARAMS,
} from '../src/crypto/password-hasher.js';

describe('password-hasher (Argon2id)', () => {
  it('produces a PHC-format argon2id hash carrying algorithm and parameters', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,p=\d+,t=\d+\$/);
  });

  it('round-trips: a hash verifies against the exact password it was made from', async () => {
    const hash = await hashPassword('a genuinely long passphrase with spaces');
    await expect(verifyPassword(hash, 'a genuinely long passphrase with spaces')).resolves.toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('the real password here');
    await expect(verifyPassword(hash, 'a completely different password')).resolves.toBe(false);
  });

  it('is case-sensitive and space-sensitive (no silent normalization inside hashPassword itself)', async () => {
    const hash = await hashPassword('Exactly This Casing Matters');
    await expect(verifyPassword(hash, 'exactly this casing matters')).resolves.toBe(false);
  });

  it('accepts Unicode passwords, including combining characters', async () => {
    const password = 'pässwörd-with-ünïcödé-ⓒⓗⓐⓡⓢ-🔒';
    const hash = await hashPassword(password);
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
  });

  it('never throws for a malformed/foreign hash string - treats it as "does not verify"', async () => {
    await expect(verifyPassword('not-a-real-hash-at-all', 'anything')).resolves.toBe(false);
  });

  it('needsRehash is false for a hash produced with current parameters', async () => {
    const hash = await hashPassword('some password');
    expect(needsRehash(hash)).toBe(false);
  });

  it('needsRehash is true for a hash produced with weaker parameters than the current policy', async () => {
    const argon2 = await import('argon2');
    const weakHash = await argon2.hash('some password', {
      type: argon2.argon2id,
      memoryCost: 8192, // deliberately below ARGON2ID_PARAMS.memoryCost
      timeCost: 1,
      parallelism: 1,
    });
    expect(needsRehash(weakHash)).toBe(true);
  });

  it('ARGON2ID_PARAMS exceeds OWASP minimum guidance (m=19456 KiB, t=2, p=1)', () => {
    expect(ARGON2ID_PARAMS.memoryCost).toBeGreaterThanOrEqual(19456);
    expect(ARGON2ID_PARAMS.timeCost).toBeGreaterThanOrEqual(2);
  });
});
