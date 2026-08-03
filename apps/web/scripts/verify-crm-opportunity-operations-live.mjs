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
  const r = await pool.query(
    `SELECT to_regclass('tenant.crm_opportunity_stage_sla_policies') sla,to_regclass('tenant.crm_opportunity_forecast_snapshots') snapshots,to_regclass('tenant.crm_opportunity_saved_views') views`,
  );
  assert.ok(r.rows[0].sla && r.rows[0].snapshots && r.rows[0].views);
  console.log("Live Stage 3 opportunity governance verification passed.");
} finally {
  await pool.end();
}
