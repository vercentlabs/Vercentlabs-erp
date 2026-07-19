import fs from "node:fs";
import path from "node:path";

import { CRM_PERMISSIONS } from "@vercent/permissions";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const migrationDirectory = path.resolve(
  process.cwd(),
  "../../database/tenant/migrations",
);
const requiredTables = [
  ...new Set(
    fs
      .readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .flatMap((name) => {
        const source = fs.readFileSync(path.join(migrationDirectory, name), "utf8");
        return [...source.matchAll(/CREATE TABLE IF NOT EXISTS tenant\.(crm_[a-z0-9_]+)/gi)].map(
          (match) => match[1],
        );
      }),
  ),
].sort();

if (!requiredTables.length) {
  throw new Error("No CRM table contracts were discovered in tenant migrations.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='tenant' AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Missing CRM tables: ${missing.join(", ")}`);

  const policies = await client.query(
    `SELECT relation.relname, relation.relrowsecurity, relation.relforcerowsecurity,
       EXISTS (
         SELECT 1 FROM pg_policy policy WHERE policy.polrelid = relation.oid
       ) AS has_policy
     FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname='tenant'
       AND relation.relname = ANY($1::text[])`,
    [requiredTables],
  );
  const insecure = policies.rows
    .filter(
      (row) =>
        !row.relrowsecurity || !row.relforcerowsecurity || !row.has_policy,
    )
    .map((row) => row.relname);
  if (insecure.length) {
    throw new Error(`CRM tables without complete forced RLS: ${insecure.join(", ")}`);
  }

  const expectedPermissions = Object.values(CRM_PERMISSIONS).sort();
  const permissions = await client.query(
    "SELECT key FROM permissions WHERE key = ANY($1::text[])",
    [expectedPermissions],
  );
  const permissionKeys = new Set(permissions.rows.map((row) => row.key));
  const missingPermissions = expectedPermissions.filter(
    (key) => !permissionKeys.has(key),
  );
  if (missingPermissions.length) {
    throw new Error(
      `CRM permission catalog is incomplete: ${missingPermissions.join(", ")}`,
    );
  }

  const organizations = await client.query(
    "SELECT id, name FROM organizations WHERE status='active' ORDER BY created_at",
  );
  for (const organization of organizations.rows) {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, true)",
        [organization.id],
      );
      const foundation = await client.query(
        `SELECT
          (SELECT count(*)::int FROM tenant.crm_pipelines
            WHERE organization_id=$1 AND status='active') AS pipelines,
          (SELECT count(*)::int FROM tenant.crm_pipeline_stages
            WHERE organization_id=$1 AND status='active') AS stages,
          (SELECT count(*)::int FROM tenant.crm_lead_sources
            WHERE organization_id=$1 AND status='active') AS sources,
          (SELECT count(*)::int FROM tenant.crm_lost_reasons
            WHERE organization_id=$1 AND status='active') AS reasons,
          (SELECT count(*)::int FROM tenant.crm_tags
            WHERE organization_id=$1 AND status='active') AS tags,
          (SELECT count(*)::int FROM tenant.crm_settings
            WHERE organization_id=$1) AS settings,
          (SELECT count(*)::int FROM tenant.crm_sales_teams
            WHERE organization_id=$1 AND status='active') AS sales_teams`,
        [organization.id],
      );
      const current = foundation.rows[0];
      if (
        Number(current.pipelines) < 1 ||
        Number(current.stages) < 7 ||
        Number(current.sources) < 8 ||
        Number(current.reasons) < 8 ||
        Number(current.tags) < 4 ||
        Number(current.settings) < 1 ||
        Number(current.sales_teams) < 1
      ) {
        throw new Error(
          `CRM foundation is incomplete for ${organization.name} (${organization.id}).`,
        );
      }
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const numbering = await client.query(
      `SELECT entity_type FROM numbering_series
       WHERE organization_id=$1
         AND status='active'
         AND entity_type = ANY($2::text[])`,
      [
        organization.id,
        ["crm_lead", "crm_opportunity", "crm_campaign", "crm_activity"],
      ],
    );
    if (numbering.rows.length !== 4) {
      throw new Error(
        `CRM numbering is incomplete for ${organization.name} (${organization.id}).`,
      );
    }
  }

  console.log(
    `CRM database verified: ${requiredTables.length} tables, ${policies.rows.length} forced-RLS contracts, ${expectedPermissions.length} permissions and ${organizations.rows.length} organization foundations.`,
  );
} finally {
  client.release();
  await pool.end();
}
