import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * SHA-256 hex digest, used for every high-entropy capability token this
 * module issues (session tokens, invitation/verification/password-reset
 * tokens, recovery codes). Deliberately NOT Argon2id: these values are
 * server-generated with >=256 bits of randomness, not human-chosen
 * passwords, so a fast cryptographic hash is the correct tool - Argon2id's
 * deliberate slowness exists to compensate for low-entropy human input,
 * which does not apply here, and would only add needless latency to every
 * session-validating request. See docs/security/password-security.md.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** >=256 bits of cryptographically secure randomness, base64url-encoded (URL/cookie-safe, no padding). */
export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Constant-time comparison for anywhere a raw secret must be compared directly (not via a stored hash lookup). */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
