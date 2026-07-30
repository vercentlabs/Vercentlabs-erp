import type { SQLiteDatabase } from "expo-sqlite";
import { foundationMigration } from "./001-foundation";
import { mutationRecoveryMigration } from "./002-mutation-recovery";

const migrations = [foundationMigration, mutationRecoveryMigration].sort(
  (left, right) => left.version - right.version,
);

export async function runMobileMigrations(database: SQLiteDatabase) {
  await database.execAsync(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    (
      await database.getAllAsync<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
    ).map((row) => row.version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await database.withTransactionAsync(async () => {
      const existing = await database.getAllAsync<{ version: number }>(
        "SELECT version FROM schema_migrations WHERE version = ?",
        migration.version,
      );
      if (existing[0]) return;
      await migration.up(database);
      await database.runAsync(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        migration.version,
        Date.now(),
      );
    });
  }
}
