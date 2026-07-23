import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

const keyName = "vercent.mobile.database-key.v1";
const databaseName = "vercent-mobile.db";
const recoveryIdentityName = "vercent.mobile.database-recovery.v1";
const recoveredDatabaseNamePattern = /^vercent-mobile-[a-f0-9]{16}\.db$/;
const databaseKeyPattern = /^[a-f0-9]{64}$/;
const workspaceOwnerScope = "workspace-owner";
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;
type DatabaseIdentity = {
  databaseName: string;
  key: string;
};


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


async function databaseIdentity(): Promise<DatabaseIdentity> {
  const stored = await SecureStore.getItemAsync(recoveryIdentityName);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<DatabaseIdentity>;
      if (
        typeof parsed.databaseName === "string" &&
        recoveredDatabaseNamePattern.test(parsed.databaseName) &&
        typeof parsed.key === "string" &&
        databaseKeyPattern.test(parsed.key)
      ) {
        return parsed as DatabaseIdentity;
      }
    } catch {
      // Fall back to the original database identity below.
    }
  }
  return { databaseName, key: await databaseKey() };
}

async function rotateDatabaseIdentity(): Promise<DatabaseIdentity> {
  const identity: DatabaseIdentity = {
    databaseName: `vercent-mobile-${toHex(await Crypto.getRandomBytesAsync(8))}.db`,
    key: toHex(await Crypto.getRandomBytesAsync(32)),
  };
  await SecureStore.setItemAsync(recoveryIdentityName, JSON.stringify(identity), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return identity;
}
function isUnreadableEncryptedDatabase(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /file is not a database|SQLITE_NOTADB|error code\s*:\s*26/i.test(
    message,
  );
}

async function openEncryptedDatabase(identity: DatabaseIdentity) {
  const database = await SQLite.openDatabaseAsync(identity.databaseName);
  try {
    await database.execAsync(`PRAGMA key = '${identity.key}';`);

    // SQLCipher may not validate a legacy database until the first prepared
    // statement. Probe it before returning a connection to callers.
    await database.getFirstAsync<{ count: number }>(
      "SELECT count(*) AS count FROM sqlite_master",
    );

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
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

export async function initializeDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      try {
        const identity = await databaseIdentity();
        return await openEncryptedDatabase(identity);
      } catch (error) {
        if (!isUnreadableEncryptedDatabase(error)) throw error;

        // An unreadable encrypted cache cannot be recovered. Use a fresh path
        // because Expo may retain the old native handle during Fast Refresh.
        const identity = await rotateDatabaseIdentity();
        return openEncryptedDatabase(identity);
      }
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

export async function bindOfflineWorkspace(owner: string) {
  if (!owner.trim()) throw new Error("An offline workspace owner is required.");
  const database = await initializeDatabase();
  // SQLCipher keys are connection-local. Expo's exclusive transaction API
  // creates a separate native connection that has not received PRAGMA key.
  await database.withTransactionAsync(async () => {
    const current = await database.getFirstAsync<{ metadata: string | null }>(
      "SELECT metadata FROM sync_state WHERE scope = ?",
      workspaceOwnerScope,
    );
    if (current?.metadata === owner) return;
    await database.execAsync(`
      DELETE FROM cache_entries;
      DELETE FROM mutation_queue;
      DELETE FROM sync_state;
    `);
    await database.runAsync(
      `INSERT INTO sync_state(scope, synced_at, metadata)
       VALUES (?, ?, ?)`,
      workspaceOwnerScope,
      Date.now(),
      owner,
    );
  });
}

export async function readCache<T>(cacheKey: string): Promise<{ data: T; cachedAt: number } | null> {
  const database = await initializeDatabase();
  const row = await database.getFirstAsync<{ payload: string; cached_at: number }>(
    "SELECT payload, cached_at FROM cache_entries WHERE cache_key = ?",
    cacheKey,
  );
  if (!row) return null;
  try { return { data: JSON.parse(row.payload) as T, cachedAt: row.cached_at }; }
  catch { return null; }
}

export async function writeCache(cacheKey: string, resource: string, payload: unknown) {
  const database = await initializeDatabase();
  await database.runAsync(
    `INSERT INTO cache_entries(cache_key, resource, payload, cached_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, cached_at=excluded.cached_at`,
    cacheKey,
    resource,
    JSON.stringify(payload),
    Date.now(),
  );
}

export type QueuedMutation = { id: string; operation: string; resource: string; recordId: string | null; payload: string; idempotencyKey: string; attempts: number };

export async function enqueueMutation(input: { id: string; operation: string; resource: string; recordId?: string; payload: unknown; idempotencyKey: string }) {
  const database = await initializeDatabase();
  const now = Date.now();
  await database.runAsync(
    `INSERT OR IGNORE INTO mutation_queue(id, operation, resource, record_id, payload, idempotency_key, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    input.id, input.operation, input.resource, input.recordId ?? null, JSON.stringify(input.payload), input.idempotencyKey, now, now,
  );
}

export async function pendingMutations() {
  const database = await initializeDatabase();
  return database.getAllAsync<QueuedMutation>(`SELECT id, operation, resource, record_id AS recordId, payload, idempotency_key AS idempotencyKey, attempts FROM mutation_queue WHERE state IN ('pending','failed') ORDER BY created_at LIMIT 50`);
}

export async function resolveMutation(id: string) {
  const database = await initializeDatabase();
  await database.runAsync("DELETE FROM mutation_queue WHERE id = ?", id);
}

export async function failMutation(id: string, message: string) {
  const database = await initializeDatabase();
  await database.runAsync("UPDATE mutation_queue SET state='failed', attempts=attempts+1, last_error=?, updated_at=? WHERE id=?", message.slice(0, 500), Date.now(), id);
}
