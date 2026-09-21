"use client";

import { OFFLINE_SECRETS_CLEARED_EVENT, OFFLINE_DB_NAME, OFFLINE_STORE_META, SEED_WRAP_KEY, WRAPPED_SEED_KEY } from "./offline-store-names";

// Sign-out and tenant switch call this. It removes what lets a device open its encrypted offline data without the
// server: the wrapping key and the wrapped seed. Queued sales stay on the device as ciphertext, and the same user
// regains access after signing in online, because the server re-issues the same seed. Nobody else can read them.
export async function clearOfflineSecrets(): Promise<void> {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_SECRETS_CLEARED_EVENT));
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const open = indexedDB.open(OFFLINE_DB_NAME);
    open.onerror = () => resolve();
    open.onupgradeneeded = () => {
      // The database did not exist; leave nothing behind.
      open.transaction?.abort();
    };
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE_META)) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(OFFLINE_STORE_META, "readwrite");
      tx.objectStore(OFFLINE_STORE_META).delete(SEED_WRAP_KEY);
      tx.objectStore(OFFLINE_STORE_META).delete(WRAPPED_SEED_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve();
      };
    };
  });
}
