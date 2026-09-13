import { describe, expect, it } from 'vitest';
import { validatePasswordPolicy } from '../src/password-policy.js';

describe('password policy (length-only, NIST SP 800-63B-4)', () => {
  it('rejects a password shorter than 15 characters', () => {
    const result = validatePasswordPolicy('short1234567');
    expect(result.ok).toBe(false);
  });

  it('accepts a 15-character password with no composition requirements at all', () => {
    const result = validatePasswordPolicy('all lower case!');
    expect(result.ok).toBe(true);
  });

  it('accepts a password made entirely of spaces and lowercase letters (no mandated symbols/uppercase/digits)', () => {
    const result = validatePasswordPolicy('just plain words');
    expect(result.ok).toBe(true);
  });

  it('accepts a 64+ character password (supports long passphrases)', () => {
    const longPassphrase = 'correct horse battery staple '.repeat(3).trim();
    expect(longPassphrase.length).toBeGreaterThanOrEqual(64);
    expect(validatePasswordPolicy(longPassphrase).ok).toBe(true);
  });

  it('rejects a password over the 256-character abuse-prevention ceiling', () => {
    const result = validatePasswordPolicy('a'.repeat(257));
    expect(result.ok).toBe(false);
  });

  it('accepts Unicode passwords', () => {
    const result = validatePasswordPolicy('pässwörd-with-ünïcödé-chars!!');
    expect(result.ok).toBe(true);
  });

  it('rejects a value present in the local common-password blocklist, even though it meets the length minimum', () => {
    const result = validatePasswordPolicy('1q2w3e4r5t6y7u8i');
    expect(result.ok).toBe(false);
  });

  it('is case-insensitive when checking the blocklist', () => {
    const result = validatePasswordPolicy('ABCDEFGHIJKLMNOP');
    expect(result.ok).toBe(false);
  });

  it('accepts a long, non-blocklisted, non-common passphrase', () => {
    const result = validatePasswordPolicy('purple elephants dance quietly at midnight');
    expect(result.ok).toBe(true);
  });
});
