import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

const keyName = "vercent.mobile.database-key.v1";
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function databaseKey() {
  const stored = await SecureStore.getItemAsync(keyName);
  if (stored) return stored;
  const created = toHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(keyName, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

export async function initializeDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync("vercent-mobile.db");
      const key = await databaseKey();
      await database.execAsync(`PRAGMA key = '${key}';`);
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA cipher_memory_security = ON;
        CREATE TABLE IF NOT EXISTS cache_entries (
          cache_key TEXT PRIMARY KEY,
          resource TEXT NOT NULL,
          payload TEXT NOT NULL,
          server_updated_at TEXT,
          cached_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS cache_entries_resource_idx
          ON cache_entries(resource, cached_at DESC);
        CREATE TABLE IF NOT EXISTS mutation_queue (
          id TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          resource TEXT NOT NULL,
          record_id TEXT,
          payload TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK (state IN ('pending','sending','failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_state (
          scope TEXT PRIMARY KEY,
          cursor TEXT,
          synced_at INTEGER,
          metadata TEXT
        );
      `);
      return database;
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function purgeOfflineWorkspace() {
  const database = await initializeDatabase();
  await database.execAsync(`
    DELETE FROM cache_entries;
    DELETE FROM mutation_queue;
    DELETE FROM sync_state;
  `);
}
