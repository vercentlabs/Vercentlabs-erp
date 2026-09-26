#!/usr/bin/env node
// Restore rehearsal verification (docs/operations/DISASTER_RECOVERY_RUNBOOK.md):
// run against a database restored from a backup / point in time, never
// against production traffic. Read-only.
//
//   owner connection  (MIGRATION_DATABASE_URL): schema level, classification,
//                     row-level security structure, data consistency.
//   runtime connection (DATABASE_URL, the restricted web role): behavioural
//                     tenant isolation — nothing visible without an
//                     organisation context, and only that organisation's rows
//                     with one.
// Prints JSON evidence; exit code 1 when any check fails.
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadEnvironment, report } from "./lib.mjs";

const DEFAULT_SAMPLE_TABLES = ["organization_memberships", "audit_events", "attachments", "notifications"];

async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString, application_name: "vercentlabs-restore-verify" });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function verifyRestoredDatabase({ ownerUrl, runtimeUrl, sampleTables = DEFAULT_SAMPLE_TABLES }) {
  const { readMigrationStatus } = await import("../../packages/database/src/index.js");
  const { PUBLIC_TABLES, TABLE_CLASSES } = await import("../../packages/database/src/table-classification.js");
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });

  let organizations = [];
  await withClient(ownerUrl, async (client) => {
    const migrations = await readMigrationStatus(client);
    record("schema: every expand migration applied", migrations.ready, migrations.ready ? `${migrations.applied ?? "all"} applied` : { missing: migrations.missing });

    const tables = (await client.query(`SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`)).rows;
    const unclassified = tables.filter((table) => !PUBLIC_TABLES[table.name]).map((table) => table.name);
    record("schema: every public table classified", unclassified.length === 0, unclassified.length ? { unclassified } : `${tables.length} tables`);

    const organisationClasses = new Set([TABLE_CLASSES.ORGANIZATION_SCOPED, TABLE_CLASSES.ORGANIZATION_CHILD]);
    const unprotected = tables.filter((table) => organisationClasses.has(PUBLIC_TABLES[table.name]?.class) && !(table.rls && table.forced)).map((table) => table.name);
    record("isolation: organisation-scoped platform tables have forced RLS", unprotected.length === 0, unprotected.length ? { unprotected } : undefined);

    const tenantTables = (await client.query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tenant' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity`)).rows.map((row) => row.name);
    record("isolation: every tenant table has RLS enabled", tenantTables.length === 0, tenantTables.length ? { withoutRls: tenantTables } : undefined);

    const orphans = [];
    const membership = await client.query(`SELECT count(*)::int AS count FROM public.organization_memberships m LEFT JOIN public.organizations o ON o.id=m.organization_id LEFT JOIN public.users u ON u.id=m.user_id WHERE o.id IS NULL OR u.id IS NULL`);
    if (membership.rows[0].count) orphans.push({ table: "organization_memberships", rows: membership.rows[0].count });
    const tenantWithOrganization = (await client.query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='organization_id' AND NOT a.attisdropped WHERE n.nspname='tenant' AND c.relkind='r' ORDER BY 1`)).rows.map((row) => row.name);
    for (const table of tenantWithOrganization) {
      const result = await client.query(`SELECT count(*)::int AS count FROM tenant.${pg.escapeIdentifier(table)} t WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=t.organization_id)`);
      if (result.rows[0].count) orphans.push({ table: `tenant.${table}`, rows: result.rows[0].count });
    }
    record("consistency: no rows reference a missing organisation or user", orphans.length === 0, orphans.length ? { orphans } : `${tenantWithOrganization.length + 1} tables checked`);

    const counts = (await client.query(`SELECT (SELECT count(*) FROM public.organizations)::int AS organizations, (SELECT count(*) FROM public.users)::int AS users, (SELECT max(applied_at) FROM public.schema_migrations) AS last_migration`)).rows[0];
    record("consistency: core counts readable", true, counts);
    organizations = (await client.query(`SELECT id FROM public.organizations ORDER BY created_at LIMIT 2`)).rows.map((row) => row.id);
  });

  await withClient(runtimeUrl, async (client) => {
    const role = (await client.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
    record("isolation: runtime role is restricted (no superuser, no BYPASSRLS)", Boolean(role) && !role.rolsuper && !role.rolbypassrls);

    await client.query("BEGIN");
    try {
      const leaks = [];
      for (const table of sampleTables) {
        const visible = (await client.query(`SELECT count(*)::int AS count FROM public.${pg.escapeIdentifier(table)}`)).rows[0].count;
        if (visible) leaks.push({ table, rows: visible });
      }
      record("isolation: nothing visible without an organisation context", leaks.length === 0, leaks.length ? { leaks } : `${sampleTables.length} tables`);

      if (organizations.length) {
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizations[0]]);
        const foreign = [];
        for (const table of sampleTables) {
          const rows = (await client.query(`SELECT count(*)::int AS count FROM public.${pg.escapeIdentifier(table)} WHERE organization_id IS DISTINCT FROM $1`, [organizations[0]])).rows[0].count;
          if (rows) foreign.push({ table, rows });
        }
        record("isolation: an organisation context sees only its own rows", foreign.length === 0, foreign.length ? { foreign } : `${organizations.length} organisation(s) sampled`);
      } else {
        record("isolation: an organisation context sees only its own rows", true, "no organisations in the restored database");
      }
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
    }
  });

  return { ok: checks.every((entry) => entry.ok), checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvironment();
  const { loadSecretFiles } = await import("../../packages/config/src/index.js");
  loadSecretFiles(process.env);
  const ownerUrl = String(process.env.MIGRATION_DATABASE_URL || "").trim();
  const runtimeUrl = String(process.env.DATABASE_URL || "").trim();
  if (!ownerUrl || !runtimeUrl) {
    console.error("MIGRATION_DATABASE_URL and DATABASE_URL are required.");
    process.exit(2);
  }
  const result = await verifyRestoredDatabase({ ownerUrl, runtimeUrl });
  report("restore:verify", result, { failed: !result.ok });
}
