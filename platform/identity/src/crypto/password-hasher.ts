import argon2 from 'argon2';

/**
 * Argon2id parameters, benchmarked on the actual runtime during this
 * prompt's implementation (see docs/security/password-security.md and
 * docs/decisions/ADR-0011-argon2id-password-storage.md for the full
 * benchmark table): ~73-76ms per hash on a typical development machine,
 * comfortably above OWASP's minimum baseline (m=19456 KiB, t=2, p=1) while
 * staying fast enough not to be a practical DoS vector on the login path.
 * Production should re-benchmark on its actual hardware before deploying -
 * these are a floor, not a magic constant.
 */
export const ARGON2ID_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

/** Full PHC-format string (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`) - algorithm and parameters travel with the hash itself. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_PARAMS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed/foreign-algorithm hash string throws rather than
    // returning false - treat it as "does not verify", never as an error
    // that could short-circuit a caller into a different code path.
    return false;
  }
}

/**
 * True when `hash` was produced with weaker parameters than
 * {@link ARGON2ID_PARAMS} currently specifies - the caller should rehash
 * with the fresh plaintext password immediately after a successful verify
 * in the SAME request, while the plaintext is still available, and persist
 * the new hash. Never a scheduled/background job (the plaintext would
 * already be gone).
 */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2ID_PARAMS);
}
