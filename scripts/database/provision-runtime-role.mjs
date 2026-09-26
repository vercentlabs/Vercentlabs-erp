#!/usr/bin/env node
// `pnpm db:provision:runtime-role` — runs after every migration (db:setup,
// the production migration Job). Provisions the RESTRICTED runtime roles and
// sets their privileges from the one classification
// (packages/database/src/table-classification.js):
//
//   web     DATABASE_URL         the Next.js web deployable
//   worker  WORKER_DATABASE_URL  the background worker (optional outside
//                                production; then the worker shares the web
//                                role locally)
//
// Both: LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
// NOREPLICATION, no role memberships, own nothing, no CREATE on any schema.
// Every table privilege is re-derived here (REVOKE ALL, then exactly the
// matrix), so a newly classified or reclassified table can never keep a stale
// grant. Refuses to run if any public table or SECURITY DEFINER function is
// not classified. No default privileges: tables created by a later migration
// get access only when this script classifies them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { config as loadDotEnv } from "dotenv";

import { DEFINER_FUNCTIONS, PUBLIC_TABLES, runtimePrivileges } from "../../packages/database/src/table-classification.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}

const migrationRaw = String(process.env.MIGRATION_DATABASE_URL || "").trim();
const webRaw = String(process.env.DATABASE_URL || "").trim();
const workerRaw = String(process.env.WORKER_DATABASE_URL || "").trim();
if (!migrationRaw) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!webRaw) throw new Error("DATABASE_URL is required.");

const ident = (value) => `"${String(value).replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const migrationRoleName = decodeURIComponent(new URL(migrationRaw).username);

function roleFrom(raw, label) {
  const url = new URL(raw);
  const name = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(name)) throw new Error(`Unsafe ${label} role name: ${name}`);
  if (!password) throw new Error(`${label} URL must contain a password.`);
  if (name === migrationRoleName) throw new Error(`The ${label} role must differ from the migration role.`);
  return { name, password, label };
}

const roles = [{ ...roleFrom(webRaw, "web"), kind: "web" }];
if (workerRaw) {
  const worker = { ...roleFrom(workerRaw, "worker"), kind: "worker" };
  if (worker.name === roles[0].name) throw new Error("WORKER_DATABASE_URL must use a different role from DATABASE_URL.");
  roles.push(worker);
}

const client = new Client({ connectionString: migrationRaw, application_name: "vercentlabs-runtime-role-provisioner" });

async function assertEverythingClassified() {
  const tables = (await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1`)).rows.map((row) => row.relname);
  const unclassified = tables.filter((table) => !PUBLIC_TABLES[table]);
  if (unclassified.length) throw new Error(`Unclassified public table(s): ${unclassified.join(", ")}. Classify them in packages/database/src/table-classification.js.`);
  const functions = (
    await client.query(`SELECT n.nspname||'.'||p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','tenant') AND p.prosecdef ORDER BY 1`)
  ).rows.map((row) => row.name);
  const unknownFunctions = functions.filter((name) => !DEFINER_FUNCTIONS[name]);
  if (unknownFunctions.length) throw new Error(`Unclassified SECURITY DEFINER function(s): ${unknownFunctions.join(", ")}. Register them in DEFINER_FUNCTIONS.`);
  return { tables };
}

async function provision(role, { tables }) {
  const name = ident(role.name);
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role.name]);
  if (!exists.rowCount) await client.query(`CREATE ROLE ${name} LOGIN`);
  await client.query(`ALTER ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(role.password)}`);
  const memberships = await client.query(
    `SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE member.rolname=$1`,
    [role.name],
  );
  for (const row of memberships.rows) await client.query(`REVOKE ${ident(row.rolname)} FROM ${name}`);
  const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
  await client.query(`GRANT CONNECT ON DATABASE ${ident(database)} TO ${name}`);

  for (const schema of ["public", "tenant"]) {
    const present = (await client.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount;
    if (!present) continue;
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${name}`);
    await client.query(`REVOKE CREATE ON SCHEMA ${schema} FROM ${name}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${name}`);
    await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${name}`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${name}`);
    for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON ${kind} FROM ${name}`);
    }
  }
  // Tenant schema: organisation-RLS protected business data.
  const tenant = (await client.query("SELECT 1 FROM pg_namespace WHERE nspname='tenant'")).rowCount;
  if (tenant) await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant TO ${name}`);
  // Public schema: exactly the classification matrix.
  for (const table of tables) {
    const privileges = runtimePrivileges(role.kind, table, PUBLIC_TABLES[table]);
    if (privileges.length) await client.query(`GRANT ${privileges.join(", ")} ON public.${ident(table)} TO ${name}`);
  }
  // SECURITY DEFINER functions: only the registered ones for this role.
  for (const [qualified, entry] of Object.entries(DEFINER_FUNCTIONS)) {
    if (!entry[role.kind]) continue;
    const [schema, fn] = qualified.split(".");
    const signatures = (await client.query(`SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2`, [schema, fn])).rows;
    for (const { signature } of signatures) await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${name}`);
  }
  // Invoker functions (RLS helpers, trigger helpers) stay executable through
  // PUBLIC; they run with the caller's own (restricted) rights.

  const ownership = await client.query(
    `SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=$1 AND n.nspname IN ('public','tenant')`,
    [role.name],
  );
  if (Number(ownership.rows[0]?.count || 0) > 0) throw new Error(`${role.name} owns application relations; runtime roles must not own schema objects.`);
  console.log(`Restricted ${role.kind} role ready: ${role.name}`);
}

async function main() {
  await client.connect();
  await client.query("BEGIN");
  try {
    const inventory = await assertEverythingClassified();
    for (const role of roles) await provision(role, inventory);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  if (!workerRaw) console.log("WORKER_DATABASE_URL is not set: the worker shares the web role (allowed outside production only).");
}

main()
  .finally(() => client.end().catch(() => undefined))
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
