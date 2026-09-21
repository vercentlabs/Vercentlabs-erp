import { test } from "node:test";
import assert from "node:assert/strict";

import { forgetSeed, persistSeed, recoverSeed, type MetaStore } from "./seed-vault.ts";

function memoryStore(): MetaStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    get: async (k) => rows.get(k),
    put: async (k, v) => void rows.set(k, v),
    delete: async (k) => void rows.delete(k),
  };
}

test("a cold offline reload recovers the seed from the device store alone", async () => {
  const store = memoryStore();
  await persistSeed(store, "server-issued-seed");
  // Simulates reload: no in-memory state, only what persisted.
  assert.equal(await recoverSeed(store), "server-issued-seed");
});

test("the seed is not stored in plaintext", async () => {
  const store = memoryStore();
  await persistSeed(store, "server-issued-seed");
  assert.ok(!JSON.stringify(store.rows.get("wrappedSeed")).includes("server-issued-seed"));
});

test("the wrapping key is non-extractable", async () => {
  const store = memoryStore();
  await persistSeed(store, "s");
  const key = store.rows.get("seedWrapKey") as CryptoKey;
  assert.equal(key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
});

test("after sign-out the seed cannot be recovered offline", async () => {
  const store = memoryStore();
  await persistSeed(store, "s");
  await forgetSeed(store);
  assert.equal(await recoverSeed(store), null);
});

test("a new seed replaces the old one (server rotated it)", async () => {
  const store = memoryStore();
  await persistSeed(store, "old");
  await persistSeed(store, "new");
  assert.equal(await recoverSeed(store), "new");
});

test("corrupted wrapped seed yields null rather than throwing", async () => {
  const store = memoryStore();
  await persistSeed(store, "s");
  store.rows.set("wrappedSeed", { iv: [1, 2, 3], data: [9, 9, 9] });
  assert.equal(await recoverSeed(store), null);
});
