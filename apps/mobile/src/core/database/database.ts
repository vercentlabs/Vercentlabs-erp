import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import { runMobileMigrations } from "./migrations";

const keyName = "vercentlabs.mobile.database-key.v1";
const databaseName = "vercentlabs-mobile.db";
const recoveryIdentityName = "vercentlabs.mobile.database-recovery.v1";
const recoveredDatabaseNamePattern = /^vercentlabs-mobile-[a-f0-9]{16}\.db$/;
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
    databaseName: `vercentlabs-mobile-${toHex(await Crypto.getRandomBytesAsync(8))}.db`,
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
    `);
    await runMobileMigrations(database);
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
    DELETE FROM mutation_dead_letters;
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
      DELETE FROM mutation_dead_letters;
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

export type QueuedMutation = { id: string; operation: string; resource: string; recordId: string | null; payload: string; idempotencyKey: string; attempts: number; nextAttemptAt: number | null };
export type DeadLetterMutation = QueuedMutation & { lastError: string; lastHttpStatus: number | null; failedAt: number };

export async function enqueueMutation(input: { id: string; operation: string; resource: string; recordId?: string; payload: unknown; idempotencyKey: string }) {
  const database = await initializeDatabase();
  const now = Date.now();
  await database.runAsync(
    `INSERT OR IGNORE INTO mutation_queue(id, operation, resource, record_id, payload, idempotency_key, state, created_at, updated_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    input.id, input.operation, input.resource, input.recordId ?? null, JSON.stringify(input.payload), input.idempotencyKey, now, now, now,
  );
}

export async function pendingMutations() {
  const database = await initializeDatabase();
  const now = Date.now();
  return database.getAllAsync<QueuedMutation>(
    `SELECT id, operation, resource, record_id AS recordId, payload,
      idempotency_key AS idempotencyKey, attempts, next_attempt_at AS nextAttemptAt
     FROM mutation_queue
     WHERE attempts < 5
       AND (
         (state IN ('pending','failed') AND COALESCE(next_attempt_at, 0) <= ?)
         OR (state='sending' AND updated_at <= ?)
       )
     ORDER BY created_at LIMIT 50`,
    now,
    now - 5 * 60 * 1000,
  );
}

export async function markMutationSending(id: string) {
  const database = await initializeDatabase();
  await database.runAsync(
    "UPDATE mutation_queue SET state='sending', updated_at=? WHERE id=?",
    Date.now(),
    id,
  );
}

export async function resolveMutation(id: string) {
  const database = await initializeDatabase();
  await database.runAsync("DELETE FROM mutation_queue WHERE id = ?", id);
}

export async function failMutation(
  id: string,
  message: string,
  options: { retryable?: boolean; httpStatus?: number } = {},
) {
  const database = await initializeDatabase();
  const row = await database.getFirstAsync<{ attempts: number }>(
    "SELECT attempts FROM mutation_queue WHERE id=?",
    id,
  );
  if (!row) return;
  const attempts = row.attempts + 1;
  const retryable = options.retryable !== false && attempts < 5;
  const delay = retryable ? Math.min(60 * 60 * 1000, 2 ** attempts * 5_000) : null;
  const now = Date.now();
  const finalMessage = message.slice(0, 500);
  if (!retryable) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        `INSERT OR REPLACE INTO mutation_dead_letters(
           id,operation,resource,record_id,payload,idempotency_key,attempts,
           last_error,last_http_status,created_at,failed_at
         )
         SELECT id,operation,resource,record_id,payload,idempotency_key,?, ?, ?,
                created_at, ?
           FROM mutation_queue WHERE id=?`,
        attempts,
        finalMessage,
        options.httpStatus ?? null,
        now,
        id,
      );
      await database.runAsync("DELETE FROM mutation_queue WHERE id=?", id);
    });
    return;
  }
  await database.runAsync(
    `UPDATE mutation_queue SET state='failed', attempts=?, last_error=?,
       last_http_status=?, next_attempt_at=?, updated_at=? WHERE id=?`,
    attempts,
    finalMessage,
    options.httpStatus ?? null,
    now + (delay ?? 0),
    now,
    id,
  );
}

export async function deadLetterMutations() {
  const database = await initializeDatabase();
  return database.getAllAsync<DeadLetterMutation>(
    `SELECT id,operation,resource,record_id AS recordId,payload,
            idempotency_key AS idempotencyKey,attempts,NULL AS nextAttemptAt,
            last_error AS lastError,last_http_status AS lastHttpStatus,
            failed_at AS failedAt
       FROM mutation_dead_letters ORDER BY failed_at DESC LIMIT 100`,
  );
}

export async function retryDeadLetterMutation(id: string) {
  const database = await initializeDatabase();
  const now = Date.now();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT OR REPLACE INTO mutation_queue(
         id,operation,resource,record_id,payload,idempotency_key,state,attempts,
         last_error,created_at,updated_at,next_attempt_at,last_http_status
       )
       SELECT id,operation,resource,record_id,payload,idempotency_key,'pending',0,
              NULL,created_at,?, ?, NULL
         FROM mutation_dead_letters WHERE id=?`,
      now,
      now,
      id,
    );
    await database.runAsync("DELETE FROM mutation_dead_letters WHERE id=?", id);
  });
}

export async function discardDeadLetterMutation(id: string) {
  const database = await initializeDatabase();
  await database.runAsync("DELETE FROM mutation_dead_letters WHERE id=?", id);
}
