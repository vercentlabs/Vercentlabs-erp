import type { SQLiteDatabase } from "expo-sqlite";

async function ensureColumn(
  database: SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (!columns.some((entry) => entry.name === column)) {
    await database.execAsync(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
  }
}

export const mutationRecoveryMigration = {
  version: 2,
  async up(database: SQLiteDatabase) {
    await ensureColumn(database, "mutation_queue", "next_attempt_at", "INTEGER");
    await ensureColumn(database, "mutation_queue", "last_http_status", "INTEGER");
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS mutation_dead_letters (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        resource TEXT NOT NULL,
        record_id TEXT,
        payload TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT NOT NULL,
        last_http_status INTEGER,
        created_at INTEGER NOT NULL,
        failed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mutation_dead_letters_failed_idx
        ON mutation_dead_letters(failed_at DESC);
    `);
    await database.runAsync(
      `UPDATE mutation_queue
          SET next_attempt_at = COALESCE(next_attempt_at, created_at)
        WHERE next_attempt_at IS NULL AND attempts < 5`,
    );
  },
} as const;
