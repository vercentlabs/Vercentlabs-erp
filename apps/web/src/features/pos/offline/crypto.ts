"use client";

// F297 — encryption at rest for the offline POS queue/snapshot.
//
// THREAT MODEL (read before touching this file): a browser tab has no
// secure enclave and no OS keychain access, so nothing client-side can
// stop code running in the SAME origin at the SAME time from reading
// plaintext before it is ever encrypted, or from asking the server for a
// fresh key itself. What this DOES protect against is the two realistic
// threats for a device that is offline for a while with money-bearing
// data sitting in it: (1) the device's IndexedDB files being copied off
// the machine at rest -- lost/stolen hardware, a filesystem backup, a
// second OS-level user account on a shared machine -- and (2) a device
// profile being inspected by someone who was never an authenticated
// session on it. Neither of those attackers can derive the AES-GCM key
// without BOTH halves below, and getting either half alone (a copied
// profile, or a leaked seed) is not enough.
//
// Key derivation: AES-256-GCM key derived via PBKDF2-SHA256 (210,000
// iterations -- OWASP's current minimum recommendation for PBKDF2-SHA256)
// from two ingredients that must BOTH be present:
//   1. `encryptionSeed` -- a random secret minted server-side per user
//      (tenant.pos_offline_device_keys, services/api/src/modules/
//      point-of-sale/features/offline-sync.js) and delivered ONLY inside
//      the authenticated HTTPS offline-snapshot response. It never
//      touches disk on its own.
//   2. `deviceSalt` -- a random value generated once client-side via
//      crypto.getRandomValues() and stored UNENCRYPTED in this same
//      IndexedDB database (a PBKDF2 salt is not a secret by design; its
//      job is to make the derived key unique per browser profile, not to
//      hide anything).
// The derived CryptoKey itself is kept ONLY in an in-memory module
// variable for the lifetime of the tab -- it is marked non-extractable
// and is never written to IndexedDB, localStorage, or anywhere else
// persistent. A page reload re-derives it from the two ingredients above
// (re-fetching the seed from the last cached snapshot, or from the
// server if online) rather than ever persisting the key.
//
// What this explicitly does NOT protect against: malicious or compromised
// JavaScript running in this same origin while the key is live in memory
// (it can call these same functions), a compromised/rooted device the
// legitimate cashier is already logged into, or a server-side compromise
// of the seed-issuing endpoint. It is a real, deliberate mechanism for a
// stated threat model -- not a claim of end-to-end confidentiality against
// an attacker who controls the runtime.

const PBKDF2_ITERATIONS = 210_000;

let cachedKey: CryptoKey | null = null;
let cachedKeyFingerprint: string | null = null;

function fingerprint(seed: string, salt: Uint8Array): string {
  return `${seed}:${Array.from(salt).join(",")}`;
}

export async function deriveOfflineKey(encryptionSeed: string, deviceSalt: Uint8Array): Promise<CryptoKey> {
  const fp = fingerprint(encryptionSeed, deviceSalt);
  if (cachedKey && cachedKeyFingerprint === fp) return cachedKey;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(encryptionSeed), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: deviceSalt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKey = key;
  cachedKeyFingerprint = fp;
  return key;
}

export function clearOfflineKeyCache(): void {
  cachedKey = null;
  cachedKeyFingerprint = null;
}

export type EncryptedBlob = { iv: number[]; data: number[] };

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const iv = new Uint8Array(blob.iv);
  const data = new Uint8Array(blob.data);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
