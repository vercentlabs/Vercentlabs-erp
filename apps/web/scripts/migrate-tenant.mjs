import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const migrationsDirectory = path.resolve(
  process.cwd(),
  "../../database/tenant/migrations",
);

const files = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, name), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");

    const existing = await pool.query(
      "SELECT checksum FROM tenant_schema_migrations WHERE name = $1",
      [name],
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(
          `Tenant migration ${name} changed after it was applied.`,
        );
      }
      console.log(`Skipped ${name}`);
      continue;
    }

    await pool.query(sql);
    await pool.query(
      `
        INSERT INTO tenant_schema_migrations (name, checksum)
        VALUES ($1, $2)
      `,
      [name, checksum],
    );
    console.log(`Applied ${name}`);
  }

  console.log("Tenant migrations completed.");
} finally {
  await pool.end();
}
