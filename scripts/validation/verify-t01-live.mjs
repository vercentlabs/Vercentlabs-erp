#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { config as loadDotEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required for T01 live verification.");

const client = new Client({ connectionString, application_name: "vercentlabs-verify-t01-live" });
const failures = [];
const fail = (message) => failures.push(message);

async function main() {
  await client.connect();
  const migrations = await client.query(
    `SELECT scope,filename FROM public.schema_migrations
      WHERE (scope='platform' AND filename='035_t01_shared_platform_completion.sql')
         OR (scope='tenant' AND filename='075_t01_import_idempotency.sql')`,
  );
  const applied = new Set(migrations.rows.map((row) => `${row.scope}:${row.filename}`));
  if (!applied.has("platform:035_t01_shared_platform_completion.sql")) fail("platform migration 035 is not recorded as applied");
  if (!applied.has("tenant:075_t01_import_idempotency.sql")) fail("tenant migration 075 is not recorded as applied");

  const tables = [
    "billing_usage_events","workflow_runs","notification_preferences","inbound_mail_events","tag_definitions","entity_tags",
    "developer_apps","api_keys","oauth_states","oauth_connections","configuration_versions","feature_flags","privacy_retention_policies",
    "privacy_requests","report_definitions","report_runs","ai_policies","ai_requests","ai_evaluations",
  ];
  for (const table of tables) {
    const { rows } = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
    if (!rows[0]?.present) fail(`public.${table} is missing after migration 035`);
  }
  const tenantColumns = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='tenant' AND table_name='master_data_import_jobs'
        AND column_name IN ('idempotency_key','request_fingerprint','result_payload')`,
  );
  const columns = new Set(tenantColumns.rows.map((row) => row.column_name));
  for (const column of ["idempotency_key","request_fingerprint","result_payload"]) if (!columns.has(column)) fail(`tenant.master_data_import_jobs.${column} is missing`);

  const index = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='tenant' AND indexname='master_data_import_jobs_idempotency_uidx'`,
  );
  if (!index.rows[0]) fail("tenant import idempotency unique index is missing");

  const permissions = await client.query(
    `SELECT role.slug, permission.key
       FROM roles role
       JOIN role_permissions rp ON rp.role_id=role.id
       JOIN permissions permission ON permission.key=rp.permission_key
      WHERE role.slug IN ('organization_owner','system_administrator')
        AND permission.key IN ('integrations.manage','platform.configuration.manage','platform.extensibility.manage','platform.privacy.manage','platform.reports.manage','platform.ai.manage','platform.workflows.manage')`,
  );
  const pairs = new Set(permissions.rows.map((row) => `${row.slug}:${row.key}`));
  for (const role of ["organization_owner","system_administrator"]) {
    for (const permission of ["integrations.manage","platform.configuration.manage","platform.extensibility.manage","platform.privacy.manage","platform.reports.manage","platform.ai.manage","platform.workflows.manage"]) {
      if (!pairs.has(`${role}:${permission}`)) fail(`${role} is missing ${permission}`);
    }
  }

  const companyAdminPrivileges = await client.query(
    `SELECT permission.key
       FROM roles role
       JOIN role_permissions rp ON rp.role_id=role.id
       JOIN permissions permission ON permission.key=rp.permission_key
      WHERE role.slug='company_administrator'
        AND permission.key IN ('integrations.manage','platform.configuration.manage','platform.extensibility.manage','platform.privacy.manage','platform.reports.manage','platform.ai.manage','platform.workflows.manage')
      LIMIT 1`,
  );
  if (companyAdminPrivileges.rows[0]) fail(`company_administrator unexpectedly has ${companyAdminPrivileges.rows[0].key}`);

  if (failures.length) {
    console.error("T01 LIVE DATABASE VALIDATION FAILED");
    for (const item of failures) console.error(" -", item);
    process.exitCode = 1;
    return;
  }
  console.log("T01 LIVE DATABASE VALIDATION PASSED");
  console.log(" - platform migration 035 applied");
  console.log(" - tenant migration 075 applied");
  console.log(` - shared-platform tables verified: ${tables.length}`);
  console.log(" - import idempotency columns/index verified");
  console.log(" - owner/system-admin platform permissions verified; company-admin privilege boundary verified");
}

main().finally(() => client.end().catch(() => undefined)).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
