import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Versioned key-provider abstraction for encrypting TOTP secrets at rest
 * (AES-256-GCM - a standard, audited primitive from Node's built-in
 * `crypto` module, not a hand-rolled cipher). `key_version` is stored
 * alongside the ciphertext so keys can be rotated later: decrypt with the
 * key the ciphertext was written under, re-encrypt with the current key,
 * without a single flag-day migration.
 *
 * The default provider reads `TOTP_ENCRYPTION_KEYS` (a JSON map of
 * `{ "<version>": "<32-byte key, base64>" }`) from the environment and
 * always encrypts new secrets under `TOTP_ENCRYPTION_CURRENT_KEY_VERSION`.
 * Production must supply real keys via a secrets manager; there is no
 * hardcoded default key - a missing/invalid key fails closed (throws),
 * exactly like `RUNTIME_DATABASE_URL`/`PLATFORM_ADMIN_DATABASE_URL` fail
 * closed rather than silently falling back to something insecure.
 */
export interface TotpKeyProvider {
  readonly currentKeyVersion: number;
  getKey(version: number): Buffer;
}

export class EnvironmentTotpKeyProvider implements TotpKeyProvider {
  private readonly keys: Map<number, Buffer>;
  public readonly currentKeyVersion: number;

  constructor(keysJson: string, currentKeyVersion: number) {
    const parsed = JSON.parse(keysJson) as Record<string, string>;
    this.keys = new Map(
      Object.entries(parsed).map(([version, base64Key]) => [
        Number(version),
        Buffer.from(base64Key, 'base64'),
      ]),
    );
    for (const [version, key] of this.keys) {
      if (key.length !== 32) {
        throw new Error(
          `TOTP encryption key version ${version} must be 32 bytes (AES-256), got ${key.length}.`,
        );
      }
    }
    if (!this.keys.has(currentKeyVersion)) {
      throw new Error(
        `TOTP_ENCRYPTION_CURRENT_KEY_VERSION ${currentKeyVersion} has no matching key.`,
      );
    }
    this.currentKeyVersion = currentKeyVersion;
  }

  getKey(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`No TOTP encryption key registered for version ${version}.`);
    }
    return key;
  }
}

export interface EncryptedTotpSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export function encryptTotpSecret(provider: TotpKeyProvider, secret: string): EncryptedTotpSecret {
  const iv = randomBytes(12); // 96-bit IV, the size AES-GCM is designed for.
  const key = provider.getKey(provider.currentKeyVersion);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: provider.currentKeyVersion };
}

export function decryptTotpSecret(
  provider: TotpKeyProvider,
  encrypted: EncryptedTotpSecret,
): string {
  const key = provider.getKey(encrypted.keyVersion);
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.iv);
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString('utf8');
}
