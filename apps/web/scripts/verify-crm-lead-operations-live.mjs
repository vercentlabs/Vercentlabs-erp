import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const tables = await pool.query(
    `SELECT to_regclass('tenant.crm_lead_saved_views') views,to_regclass('tenant.crm_lead_assignment_events') events,to_regclass('tenant.crm_lead_sla_policies') sla`,
  );
  assert.ok(
    tables.rows[0].views && tables.rows[0].events && tables.rows[0].sla,
  );
  const policies = await pool.query(
    `SELECT count(*)::int count FROM tenant.crm_lead_sla_policies`,
  );
  assert.ok(Number(policies.rows[0].count) >= 1);
  console.log("Live Stage 2C + 2D lead operations verification passed.");
} finally {
  await pool.end();
}
