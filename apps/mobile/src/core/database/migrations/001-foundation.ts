export const foundationMigration = {
  version: 1,
  statements: [
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  ],
} as const;
