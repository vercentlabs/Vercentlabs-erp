import { decryptJson, encryptJson, type EncryptedBlob } from "./crypto.ts";

// Lets a cold offline reload recover the encryption seed without the server.
//
// Before this, the seed lived only in memory, but the snapshot that carried it was itself encrypted with a key derived
// from that seed, so an offline restart could not decrypt anything. Now the seed is wrapped (AES-GCM) under a
// non-extractable device key that is persisted as a CryptoKey object, which JavaScript cannot read back as bytes.
//
// Honest limits: this defends against script that cannot call these functions and against casual export of the
// database rows; it does not defend against a copy of the whole browser profile or code running in this origin,
// which is the same boundary crypto.ts already documents. Sign-out and tenant switch remove the wrapping key (see
// shared/offline/clear-offline-secrets.ts), so a signed-out device cannot open its queue until the same user signs
// in online again.
export type MetaStore = {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

export const SEED_WRAP_KEY = "seedWrapKey";
export const WRAPPED_SEED_KEY = "wrappedSeed";

async function getOrCreateWrapKey(store: MetaStore): Promise<CryptoKey> {
  const existing = (await store.get(SEED_WRAP_KEY)) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await store.put(SEED_WRAP_KEY, key);
  return key;
}

export async function persistSeed(store: MetaStore, seed: string): Promise<void> {
  const key = await getOrCreateWrapKey(store);
  await store.put(WRAPPED_SEED_KEY, await encryptJson(key, seed));
}

export async function recoverSeed(store: MetaStore): Promise<string | null> {
  const key = (await store.get(SEED_WRAP_KEY)) as CryptoKey | undefined;
  const wrapped = (await store.get(WRAPPED_SEED_KEY)) as EncryptedBlob | undefined;
  if (!key || !wrapped) return null;
  try {
    return await decryptJson<string>(key, wrapped);
  } catch {
    return null;
  }
}

export async function forgetSeed(store: MetaStore): Promise<void> {
  await store.delete(SEED_WRAP_KEY);
  await store.delete(WRAPPED_SEED_KEY);
}
