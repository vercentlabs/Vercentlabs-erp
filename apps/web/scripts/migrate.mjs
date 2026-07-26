import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

import { runMigrations } from "./migration-runner.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for schema migrations.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  await runMigrations({
    pool,
    directory: path.resolve(
      process.cwd(),
      "../../database/control-plane/migrations",
    ),
    tableName: "schema_migrations",
    lockName: "vercentlabs-control-plane-migrations",
    label: "Control-plane",
  });
} finally {
  await pool.end();
}
