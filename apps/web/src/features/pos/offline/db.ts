"use client";

// F297 — the offline IndexedDB store. Deliberately NOT localStorage: the
// task requires a bounded catalog snapshot (up to OFFLINE_SNAPSHOT_ITEM_
// LIMIT=2000 items) plus a growing queue of full sale payloads, both of
// which can comfortably exceed localStorage's ~5MB synchronous quota and
// would block the main thread on every read/write at that size.
//
// Every commercially-sensitive value (the snapshot's prices/permissions,
// each queued sale's line items/totals) is stored as an AES-GCM
// ciphertext blob, never as plaintext -- see crypto.ts for the exact key
// derivation and its threat model. Non-sensitive bookkeeping fields
// (status, timestamps, ids) are kept in plaintext alongside the blob so
// the UI can list/filter the queue without decrypting every row.
import { deriveOfflineKey, decryptJson, encryptJson, type EncryptedBlob } from "./crypto";
import type { PosOfflineQueuedSale, PosOfflineSnapshot } from "./types";

const DB_NAME = "vercentlabs-pos-offline";
const DB_VERSION = 1;
const STORE_META = "meta";
const STORE_SNAPSHOTS = "snapshots";
const STORE_QUEUE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "storeId" });
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: "localTransactionId" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T = void>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | void): Promise<T> {
  const db = await openDb();
  try {
    let pending: Promise<T> | undefined;
    const result = await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const outcome = fn(store);
      pending = outcome instanceof Promise ? outcome : undefined;
      tx.oncomplete = () => resolve(undefined as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return pending !== undefined ? await pending : result;
  } finally {
    db.close();
  }
}

// A salt is not a secret -- see crypto.ts -- so it is fine to keep in
// plaintext in IndexedDB. It exists purely so the derived key is unique
// per browser profile even when the server-issued seed is later reused.
async function getOrCreateDeviceSalt(): Promise<Uint8Array> {
  const db = await openDb();
  try {
    const existing = await new Promise<{ key: string; value: number[] } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readonly");
      const request = tx.objectStore(STORE_META).get("deviceSalt");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (existing) return new Uint8Array(existing.value);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put({ key: "deviceSalt", value: Array.from(salt) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return salt;
  } finally {
    db.close();
  }
}

let lastKnownSeed: string | null = null;

async function getKey(encryptionSeed?: string): Promise<CryptoKey> {
  const seed = encryptionSeed ?? lastKnownSeed;
  if (!seed) throw new Error("No offline encryption seed is available yet -- fetch a snapshot while online first.");
  lastKnownSeed = seed;
  const salt = await getOrCreateDeviceSalt();
  return deriveOfflineKey(seed, salt);
}

// The store/terminal/shift/cashier a device was operating under as of its
// last successful online snapshot refresh -- read by the offline checkout
// panel so it never depends on any online-only query (listPosShifts/
// listPosStores) succeeding. Refreshed by PosCheckoutScreen every time it
// has a valid open shift while online (see its useEffect).
export type PosOfflineContext = { storeId: string; terminalId: string | null; shiftId: string; cashierUserId: string };

export async function saveOfflineContext(context: PosOfflineContext): Promise<void> {
  await withStore(STORE_META, "readwrite", (store) => {
    store.put({ key: "offlineContext", value: context });
    return undefined;
  });
}

export async function loadOfflineContext(): Promise<PosOfflineContext | null> {
  const record = await withStore<{ key: string; value: PosOfflineContext } | undefined>(STORE_META, "readonly", (store) => reqToPromise(store.get("offlineContext")));
  return record?.value ?? null;
}

export async function saveSnapshot(snapshot: PosOfflineSnapshot): Promise<void> {
  const key = await getKey(snapshot.encryptionSeed);
  const blob = await encryptJson(key, snapshot);
  await withStore(STORE_SNAPSHOTS, "readwrite", (store) => {
    store.put({ storeId: snapshot.store.id, version: snapshot.version, generatedAt: snapshot.generatedAt, blob });
    return undefined;
  });
}

export async function loadSnapshot(storeId: string): Promise<PosOfflineSnapshot | null> {
  const record = await withStore<{ storeId: string; blob: EncryptedBlob } | undefined>(STORE_SNAPSHOTS, "readonly", (store) => reqToPromise(store.get(storeId)));
  if (!record) return null;
  const key = await getKey();
  return decryptJson<PosOfflineSnapshot>(key, record.blob);
}

export async function enqueueOfflineSale(sale: PosOfflineQueuedSale): Promise<void> {
  const key = await getKey();
  const blob = await encryptJson(key, sale);
  await withStore(STORE_QUEUE, "readwrite", (store) => {
    store.put({ localTransactionId: sale.localTransactionId, status: sale.status, capturedAt: sale.capturedAt, blob });
    return undefined;
  });
}

export async function listOfflineQueue(): Promise<PosOfflineQueuedSale[]> {
  const records = await withStore<Array<{ localTransactionId: string; blob: EncryptedBlob }>>(STORE_QUEUE, "readonly", (store) => reqToPromise(store.getAll()));
  const key = await getKey();
  const decrypted = await Promise.all(records.map((record) => decryptJson<PosOfflineQueuedSale>(key, record.blob)));
  return decrypted.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function updateOfflineSale(localTransactionId: string, patch: Partial<PosOfflineQueuedSale>): Promise<void> {
  const record = await withStore<{ localTransactionId: string; blob: EncryptedBlob } | undefined>(STORE_QUEUE, "readonly", (store) =>
    reqToPromise(store.get(localTransactionId)),
  );
  if (!record) return;
  const key = await getKey();
  const current = await decryptJson<PosOfflineQueuedSale>(key, record.blob);
  const next = { ...current, ...patch };
  const blob = await encryptJson(key, next);
  await withStore(STORE_QUEUE, "readwrite", (store) => {
    store.put({ localTransactionId, status: next.status, capturedAt: next.capturedAt, blob });
    return undefined;
  });
}

export async function removeOfflineSale(localTransactionId: string): Promise<void> {
  await withStore(STORE_QUEUE, "readwrite", (store) => {
    store.delete(localTransactionId);
    return undefined;
  });
}

export async function countQueuedOfflineSales(): Promise<{ queued: number; conflict: number }> {
  const records = await withStore<Array<{ status: string }>>(STORE_QUEUE, "readonly", (store) => reqToPromise(store.getAll()));
  return {
    queued: records.filter((r) => r.status === "queued" || r.status === "syncing" || r.status === "error").length,
    conflict: records.filter((r) => r.status === "conflict").length,
  };
}
