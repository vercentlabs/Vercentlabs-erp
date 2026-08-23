#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { Client } = require("pg");
const { config: loadDotEnv } = require("dotenv");

for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const migrationRaw = String(process.env.MIGRATION_DATABASE_URL || "").trim();
const runtimeRaw = String(process.env.DATABASE_URL || "").trim();
if (!migrationRaw) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!runtimeRaw) throw new Error("DATABASE_URL is required.");

const migrationUrl = new URL(migrationRaw);
const runtimeUrl = new URL(runtimeRaw);
const roleName = decodeURIComponent(runtimeUrl.username);
const rolePassword = decodeURIComponent(runtimeUrl.password);
const migrationRoleName = decodeURIComponent(migrationUrl.username);

if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(roleName)) throw new Error(`Unsafe runtime role name: ${roleName}`);
if (!rolePassword) throw new Error("DATABASE_URL must contain a runtime-role password.");
if (roleName === migrationRoleName) throw new Error("Runtime and migration database roles must be different.");

const ident = (value) => `"${String(value).replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const role = ident(roleName);
const client = new Client({ connectionString: migrationRaw, application_name: "vercentlabs-runtime-role-provisioner" });

async function main() {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [roleName]);
  if (!exists.rowCount) await client.query(`CREATE ROLE ${role} LOGIN`);

  await client.query(`ALTER ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(rolePassword)}`);

  const memberships = await client.query(
    `SELECT parent.rolname FROM pg_auth_members m
       JOIN pg_roles parent ON parent.oid=m.roleid
       JOIN pg_roles member ON member.oid=m.member
      WHERE member.rolname=$1`,
    [roleName],
  );
  for (const row of memberships.rows) await client.query(`REVOKE ${ident(row.rolname)} FROM ${role}`);

  const { rows: dbRows } = await client.query("SELECT current_database() AS name");
  await client.query(`GRANT CONNECT ON DATABASE ${ident(dbRows[0].name)} TO ${role}`);

  const { rows: schemas } = await client.query(
    "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','tenant') ORDER BY nspname",
  );
  for (const row of schemas) {
    const schema = ident(row.nspname);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await client.query(`REVOKE CREATE ON SCHEMA ${schema} FROM ${role}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT EXECUTE ON FUNCTIONS TO ${role}`);
  }

  const history = await client.query("SELECT to_regclass('public.schema_migrations') AS relation");
  if (history.rows[0]?.relation) await client.query(`REVOKE ALL ON public.schema_migrations FROM ${role}`);

  const ownership = await client.query(
    `SELECT count(*)::int AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
      WHERE r.rolname=$1 AND n.nspname IN ('public','tenant')`,
    [roleName],
  );
  if (Number(ownership.rows[0]?.count || 0) > 0) throw new Error(`${roleName} owns application relations; runtime roles must not own schema objects.`);

  console.log(`Restricted runtime role ready: ${roleName}`);
}

main()
  .finally(() => client.end().catch(() => undefined))
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
