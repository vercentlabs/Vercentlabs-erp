import { normalizePassword } from './crypto/password-normalize.js';
import { isCommonPassword } from './crypto/password-blocklist.js';

const MIN_LENGTH = 15;
const MAX_LENGTH = 256;

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * Length-only policy (NIST SP 800-63B-4): no mandatory symbols/uppercase/
 * digits, no silent truncation, spaces and Unicode accepted as-is. The
 * blocklist check runs entirely in-process against
 * {@link isCommonPassword} - the plaintext never leaves this function, let
 * alone the process. See docs/security/password-security.md.
 */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${MAX_LENGTH} characters.` };
  }
  const normalized = normalizePassword(password);
  if (isCommonPassword(normalized)) {
    return { ok: false, reason: 'This password is too common. Please choose a different one.' };
  }
  return { ok: true };
}
