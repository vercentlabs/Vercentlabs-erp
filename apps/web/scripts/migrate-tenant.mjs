import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

import { runMigrations } from "./migration-runner.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for tenant migrations.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  await runMigrations({
    pool,
    directory: path.resolve(process.cwd(), "../../database/tenant/migrations"),
    tableName: "tenant_schema_migrations",
    lockName: "vercentlabs-tenant-migrations",
    label: "Tenant",
  });
} finally {
  await pool.end();
}
