#!/usr/bin/env node
// Restores ONE company from a backup (Shared Platform plan 8; runbook: docs/operations/DISASTER_RECOVERY_RUNBOOK.md, "Restore one company").
//
//   node services/worker/bin/restore-company.mjs --source <backup database URL> --target <database URL> --organization <uuid> [--apply]
//
// The source is the backup restored into its own database (point-in-time or a nightly dump). Every row of the company — the organization,
// its memberships, roles and settings, every tenant table, its files' metadata — is copied from the source into the target: the
// company's current rows are deleted first, then the backup's rows are inserted, all in one transaction (nothing changes if anything
// fails). People (users) the company needs and the target lacks are added; other companies are never touched.
// Without --apply it only reports what it would do (row counts per table). Run it as the database owner (it disables triggers and
// foreign-key checks for the copy: session_replication_role = replica).
import pg from "pg";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : true]);
  return pairs;
}, []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!args.source || !args.target || !UUID.test(String(args.organization ?? ""))) {
  console.error("Usage: restore-company.mjs --source <backup URL> --target <URL> --organization <uuid> [--apply]");
  process.exit(2);
}
const organizationId = String(args.organization);
const apply = args.apply === true;
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

// The columns an insert may name (generated columns are computed again by the target).
async function insertableColumns(client, schema, name) {
  return (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [schema, name])).rows
    .map((row) => quote(row.column_name)).join(", ");
}
async function insertRows(client, schema, name, rows) {
  if (!rows.length) return;
  const table = `${quote(schema)}.${quote(name)}`;
  const columns = await insertableColumns(client, schema, name);
  for (let start = 0; start < rows.length; start += 1000)
    await client.query(`INSERT INTO ${table} (${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM json_populate_recordset(NULL::${table}, $1::json)`, [JSON.stringify(rows.slice(start, start + 1000))]);
}

// Tables that hold a company's rows: every table with an organization_id column (and the organizations row itself).
async function companyTables(client) {
  const { rows } = await client.query(
    `SELECT table_schema, table_name FROM information_schema.columns
      WHERE column_name = 'organization_id' AND table_schema IN ('public', 'tenant')
        AND (table_schema, table_name) IN (SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE')
      ORDER BY table_schema, table_name`);
  return rows.map((row) => ({ schema: row.table_schema, name: row.table_name }));
}

async function main() {
  const source = new pg.Client({ connectionString: args.source });
  const target = new pg.Client({ connectionString: args.target });
  await source.connect();
  await target.connect();
  try {
    const organization = (await source.query(`SELECT * FROM public.organizations WHERE id = $1`, [organizationId])).rows[0];
    if (!organization) throw new Error(`The backup has no organization ${organizationId}.`);
    const tables = (await companyTables(source)).filter((table) => !(table.schema === "public" && table.name === "schema_migrations"));
    const targetTables = new Set((await companyTables(target)).map((table) => `${table.schema}.${table.name}`));
    const report = [];
    if (apply) {
      await target.query("BEGIN");
      await target.query("SET LOCAL session_replication_role = replica");
    }
    // The people the company's memberships name.
    const users = (await source.query(`SELECT users.* FROM public.users users JOIN public.organization_memberships membership ON membership.user_id = users.id WHERE membership.organization_id = $1`,
      [organizationId])).rows;
    const missingUsers = [];
    for (const user of users)
      if (!(await target.query(`SELECT 1 FROM public.users WHERE id = $1`, [user.id])).rows[0]) missingUsers.push(user);
    if (apply && missingUsers.length)
      await insertRows(target, "public", "users", missingUsers);
    report.push({ table: "public.users (added)", rows: missingUsers.length });

    // The company's rows: deleted from the target, then copied from the backup.
    for (const table of tables) {
      const name = `${quote(table.schema)}.${quote(table.name)}`;
      if (!targetTables.has(`${table.schema}.${table.name}`)) { report.push({ table: `${table.schema}.${table.name}`, rows: 0, note: "not in the target (skipped)" }); continue; }
      const rows = (await source.query(`SELECT * FROM ${name} WHERE organization_id = $1`, [organizationId])).rows;
      const current = Number((await target.query(`SELECT count(*) AS n FROM ${name} WHERE organization_id = $1`, [organizationId])).rows[0].n);
      if (apply) {
        await target.query(`DELETE FROM ${name} WHERE organization_id = $1`, [organizationId]);
        await insertRows(target, table.schema, table.name, rows);
      }
      if (rows.length || current) report.push({ table: `${table.schema}.${table.name}`, rows: rows.length, replaced: current });
    }
    // The organizations row last (its id is not an organization_id column).
    if (apply) {
      await target.query(`DELETE FROM public.organizations WHERE id = $1`, [organizationId]);
      await insertRows(target, "public", "organizations", [organization]);
      await target.query("COMMIT");
    }
    report.push({ table: "public.organizations", rows: 1 });
    console.table(report);
    console.log(apply ? `Restored ${organization.name} (${organizationId}).` : "Dry run: nothing was changed. Add --apply to restore.");
  } catch (error) {
    if (apply) await target.query("ROLLBACK").catch(() => undefined);
    console.error(`Restore failed, nothing was changed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

await main();
