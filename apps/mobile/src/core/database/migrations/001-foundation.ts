import type { SQLiteDatabase } from "expo-sqlite";

export const foundationMigration = {
  version: 1,
  async up(database: SQLiteDatabase) {
    await database.execAsync(`
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
  },
} as const;
