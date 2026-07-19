import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const roleName = process.env.APP_DATABASE_ROLE;
const rolePassword = process.env.APP_DATABASE_PASSWORD;

if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!roleName || !/^[a-z_][a-z0-9_]{0,62}$/i.test(roleName)) {
  throw new Error("APP_DATABASE_ROLE must be a valid PostgreSQL role name.");
}
if (!rolePassword || rolePassword.length < 24) {
  throw new Error("APP_DATABASE_PASSWORD must contain at least 24 characters.");
}

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
const role = quoteIdentifier(roleName);
const pool = new pg.Pool({ connectionString: migrationUrl, max: 1 });
const client = await pool.connect();

try {
  const database = await client.query("SELECT current_database() AS name");
  const databaseName = database.rows[0].name;
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
    roleName,
  ]);
  if (!exists.rows[0]) {
    await client.query(`CREATE ROLE ${role} LOGIN`);
  }
  await client.query(
    `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoteLiteral(rolePassword)}`,
  );
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public, tenant TO ${role}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, tenant TO ${role}`,
  );
  await client.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, tenant TO ${role}`,
  );
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, tenant TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public, tenant GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public, tenant GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public, tenant GRANT EXECUTE ON FUNCTIONS TO ${role}`);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
  await client.query(`REVOKE ALL ON FUNCTION tenant.crm_public_capture_form(text) FROM PUBLIC`);
  await client.query(`GRANT EXECUTE ON FUNCTION tenant.crm_public_capture_form(text) TO ${role}`);

  const verification = await client.query(
    `
      SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname = $1
    `,
    [roleName],
  );
  const verified = verification.rows[0];
  if (
    !verified ||
    verified.rolsuper ||
    verified.rolbypassrls ||
    verified.rolinherit ||
    verified.rolcreatedb ||
    verified.rolcreaterole
  ) {
    throw new Error("The runtime role failed its least-privilege verification.");
  }

  const ownedTables = await client.query(
    `
      SELECT count(*)::int AS count
      FROM pg_class AS relation
      JOIN pg_roles AS owner ON owner.oid = relation.relowner
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE owner.rolname = $1
        AND namespace.nspname IN ('public', 'tenant')
        AND relation.relkind IN ('r', 'p')
    `,
    [roleName],
  );
  if (ownedTables.rows[0].count !== 0) {
    throw new Error("The runtime role must not own application tables.");
  }

  console.log(`Provisioned restricted runtime role ${roleName}.`);
} finally {
  client.release();
  await pool.end();
}
