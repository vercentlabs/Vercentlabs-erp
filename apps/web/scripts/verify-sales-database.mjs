import fs from "node:fs";
import path from "node:path";

import { SALES_PERMISSIONS } from "@vercentlabs/permissions";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const migration = fs.readFileSync(path.resolve(process.cwd(), "../../database/tenant/migrations/008_sales_module.sql"), "utf8");
const requiredTables = [...new Set([...migration.matchAll(/CREATE TABLE IF NOT EXISTS tenant\.(sales_[a-z0-9_]+)/gi)].map((match) => match[1]))].sort();
if (!requiredTables.includes("sales_order_amendments")) throw new Error("Sales amendment table contract is missing.");
if (requiredTables.length < 20) throw new Error("Sales table contract is incomplete.");
const expectedPermissions = Object.values(SALES_PERMISSIONS).sort();
const requiredNumbering = ["quotation", "sales_order", "sales_fulfillment_request", "sales_invoice_request"];
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const applied = await pool.query("SELECT name FROM tenant_schema_migrations WHERE name=$1", ["008_sales_module.sql"]);
  if (!applied.rows[0]) throw new Error("Sales tenant migration is not applied.");
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='tenant' AND table_name=ANY($1::text[])", [requiredTables]);
  const tableSet = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !tableSet.has(name));
  if (missingTables.length) throw new Error(`Missing Sales tables: ${missingTables.join(", ")}`);
  const security = await pool.query(`SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity,
    EXISTS (SELECT 1 FROM pg_policy policy WHERE policy.polrelid=relation.oid) AS has_policy
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='tenant' AND relation.relname=ANY($1::text[])`, [requiredTables]);
  const insecure = security.rows.filter((row) => !row.relrowsecurity || !row.relforcerowsecurity || !row.has_policy).map((row) => row.relname);
  if (insecure.length) throw new Error(`Sales tables without complete forced RLS: ${insecure.join(", ")}`);
  const permissions = await pool.query("SELECT key FROM permissions WHERE key=ANY($1::text[])", [expectedPermissions]);
  const permissionSet = new Set(permissions.rows.map((row) => row.key));
  const missingPermissions = expectedPermissions.filter((key) => !permissionSet.has(key));
  if (missingPermissions.length) throw new Error(`Sales permission catalog is incomplete: ${missingPermissions.join(", ")}`);
  const released = await pool.query(`SELECT organization.id,organization.name,module.status
    FROM organizations organization LEFT JOIN organization_modules module
      ON module.organization_id=organization.id AND module.module_key='sales'
    WHERE organization.status='active' ORDER BY organization.created_at`);
  for (const organization of released.rows) {
    if (organization.status !== "enabled") throw new Error(`Sales is not enabled for ${organization.name} (${organization.id}).`);
    const numbering = await pool.query("SELECT entity_type FROM numbering_series WHERE organization_id=$1 AND status='active' AND entity_type=ANY($2::text[])", [organization.id, requiredNumbering]);
    const set = new Set(numbering.rows.map((row) => row.entity_type));
    const missing = requiredNumbering.filter((key) => !set.has(key));
    if (missing.length) throw new Error(`Sales numbering is incomplete for ${organization.name}: ${missing.join(", ")}.`);
  }
  console.log(`Sales database verified: ${requiredTables.length} tables, ${security.rows.length} forced-RLS contracts, ${expectedPermissions.length} permissions and ${released.rows.length} organization registrations.`);
} finally {
  await pool.end();
}
