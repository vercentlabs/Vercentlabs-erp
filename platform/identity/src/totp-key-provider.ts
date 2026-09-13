import { EnvironmentTotpKeyProvider, type TotpKeyProvider } from './crypto/totp-secret-cipher.js';

let cached: TotpKeyProvider | undefined;

/**
 * Reads `TOTP_ENCRYPTION_KEYS`/`TOTP_ENCRYPTION_CURRENT_KEY_VERSION` once
 * and caches the result for the process lifetime. Fails closed (throws) if
 * either is missing or malformed - there is no default key, exactly like
 * `RUNTIME_DATABASE_URL`/`PLATFORM_ADMIN_DATABASE_URL`.
 */
export function getTotpKeyProvider(env: NodeJS.ProcessEnv = process.env): TotpKeyProvider {
  if (cached) return cached;
  const keysJson = env['TOTP_ENCRYPTION_KEYS'];
  const currentVersion = env['TOTP_ENCRYPTION_CURRENT_KEY_VERSION'];
  if (!keysJson || !currentVersion) {
    throw new Error(
      'TOTP_ENCRYPTION_KEYS and TOTP_ENCRYPTION_CURRENT_KEY_VERSION must both be set to encrypt/decrypt TOTP secrets.',
    );
  }
  cached = new EnvironmentTotpKeyProvider(keysJson, Number(currentVersion));
  return cached;
}

/** Test-only escape hatch so tests can inject a known provider without process-wide env mutation races. */
export function resetTotpKeyProviderCache(): void {
  cached = undefined;
}
