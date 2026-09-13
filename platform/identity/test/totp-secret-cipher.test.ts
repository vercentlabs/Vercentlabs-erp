import { describe, expect, it } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  EnvironmentTotpKeyProvider,
} from '../src/crypto/totp-secret-cipher.js';

function makeProvider(): EnvironmentTotpKeyProvider {
  const key = Buffer.alloc(32, 7).toString('base64');
  return new EnvironmentTotpKeyProvider(JSON.stringify({ 1: key }), 1);
}

describe('totp-secret-cipher (AES-256-GCM, versioned key provider)', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const provider = makeProvider();
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(provider, secret);
    expect(decryptTotpSecret(provider, encrypted)).toBe(secret);
  });

  it('records the key version used to encrypt', () => {
    const provider = makeProvider();
    const encrypted = encryptTotpSecret(provider, 'SOMESECRET');
    expect(encrypted.keyVersion).toBe(1);
  });

  it('produces different ciphertext for the same secret on repeated calls (random IV)', () => {
    const provider = makeProvider();
    const a = encryptTotpSecret(provider, 'SAMESECRETVALUE');
    const b = encryptTotpSecret(provider, 'SAMESECRETVALUE');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it('fails to decrypt if the auth tag has been tampered with (AEAD integrity)', () => {
    const provider = makeProvider();
    const encrypted = encryptTotpSecret(provider, 'SOMESECRET');
    const tampered = { ...encrypted, authTag: Buffer.from(encrypted.authTag) };
    tampered.authTag[0] = (tampered.authTag[0] ?? 0) ^ 0xff;
    expect(() => decryptTotpSecret(provider, tampered)).toThrow();
  });

  it('rejects a key that is not exactly 32 bytes (AES-256 requirement)', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => new EnvironmentTotpKeyProvider(JSON.stringify({ 1: shortKey }), 1)).toThrow(
      /32 bytes/,
    );
  });

  it('rejects a currentKeyVersion with no matching key', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    expect(() => new EnvironmentTotpKeyProvider(JSON.stringify({ 1: key }), 2)).toThrow(
      /no matching key/,
    );
  });

  it('supports key rotation: decrypting a secret encrypted under an older version still works after the current version changes', () => {
    const keyV1 = Buffer.alloc(32, 1).toString('base64');
    const keyV2 = Buffer.alloc(32, 2).toString('base64');
    const providerV1 = new EnvironmentTotpKeyProvider(JSON.stringify({ 1: keyV1 }), 1);
    const encrypted = encryptTotpSecret(providerV1, 'ROTATE-ME-SECRET');

    const providerV2 = new EnvironmentTotpKeyProvider(JSON.stringify({ 1: keyV1, 2: keyV2 }), 2);
    expect(decryptTotpSecret(providerV2, encrypted)).toBe('ROTATE-ME-SECRET');
  });
});
